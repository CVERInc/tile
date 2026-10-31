// `tagcloud` — a weighted category/tag cloud: a heading + a flow of inline links. Mirrors the
// reference renderer's `case 'tagcloud'` (site-core.js). IR: a markdown list of `- [Label](/href)`
// items; the Label carries its own count baked in (e.g. "comic576"), as live themes print it.
import { inlineHtml, tagcloudLinks, safeHref } from '../sitetile/site-core.js';
import { attr, when } from './html.mjs';

/** @param {{ eyebrow?: unknown }} params  @param {{ hero?: boolean }} ctx */
export function emitTagcloud(section, params, ctx) {
  const Title = ctx.hero ? 'h1' : 'h2';
  const { eyebrow } = params;
  const links = tagcloudLinks(section.body, { report: true });
  return '<section class="st-tagcloud"' + attr('id', section.id) + '> '
    + when(eyebrow, () => '<p class="st-tagcloud-eyebrow">' + inlineHtml(eyebrow) + '</p>') + ' '
    + when(section.title, () => '<' + Title + '>' + inlineHtml(section.title) + '</' + Title + '>') + ' '
    + '<div class="st-tag-flow"> '
    + links.map((l) => {
      // round 4 (R3-P3-2): hoisted to a const — was two calls per item.
      const hrefOk = safeHref(l.href);
      return hrefOk
        ? '<a class="st-tag"' + attr('href', hrefOk) + '>' + inlineHtml(l.label) + '</a>'
        : '<span class="st-tag">' + inlineHtml(l.label) + '</span>';
    }).join('')
    + ' </div> </section>';
}
