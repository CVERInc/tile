// `faq` — a Q&A accordion: an optional lead, then one native <details>/<summary> per item (zero-JS,
// accessible). `open` expands every item on load. An answer body may lead with a `######` (h6)
// one-line summary, the shape live FAQs use. The THEME paints the disclosure chrome. Mirrors the
// reference renderer in site-core.js.
import { inlineHtml, bodyHtml } from '../sitetile/site-core.js';
import { attr, boolAttr, when } from './html.mjs';

/** @param {{ eyebrow?: unknown, open?: boolean }} params  @param {{ hero?: boolean }} ctx */
export function emitFaq(section, params, ctx) {
  const Title = ctx.hero && section.title ? 'h1' : 'h2';   // first section on the page → its title is the <h1>
  const { eyebrow, open } = params;
  const faqs = section.faqs || [];
  return '<section class="st-faq"' + attr('id', section.id) + '> <div class="st-faq-head"> '
    + when(eyebrow, () => '<p class="st-faq-eyebrow">' + inlineHtml(eyebrow) + '</p>') + ' '
    + when(section.title, () => '<' + Title + '>' + inlineHtml(section.title) + '</' + Title + '>') + ' '
    + when(section.body, () => bodyHtml(section.body))
    + ' </div> <div class="st-faq-list"> '
    + faqs.map((e) => '<details class="st-faq-item"' + boolAttr('open', open) + '> '
      + '<summary class="st-faq-q">' + inlineHtml(e.q) + '</summary> '
      + '<div class="st-faq-a">' + bodyHtml(e.body) + '</div> </details>').join('')
    + ' </div> </section>';
}
