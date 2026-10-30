// `people` — a roster of humans (or the companies they stand for): portrait, name, the roles they
// hold, what they do, where to find them. Mirrors the reference renderSection 'people' case.
//
// Depth is inferred at parse time: a flat roster arrives as ONE untitled group and renders without
// the group wrapper; a grouped roster renders a labelled block per group. Theme paints
// `.st-people` / `.st-person` / `.st-person-role`; site.css carries the structural defaults.
import { inlineHtml, bodyHtml, firstImage, imgTag, slugify, safeHref } from '../sitetile/site-core.js';
import { attr, text, when } from './html.mjs';

const gid = (t) => 'people-' + slugify(t, 'g');
const roles = (b) => String(b || '').split('·').map((x) => x.trim()).filter(Boolean);
const ext = (h) => /^https?:\/\//.test(h);

/**
 * @param {{ eyebrow?: unknown, cols?: unknown, shape: 'logo' | 'avatar' }} params
 * @param {{ hero?: boolean }} ctx  the page's FIRST section carries its primary heading as <h1>
 */
export function emitPeople(section, params, ctx) {
  const Title = ctx.hero && section.title ? 'h1' : 'h2';
  const { eyebrow, cols, shape } = params;
  const groups = section.groups || [];
  const flat = groups.length === 1 && !groups[0].title;
  return '<section class="st-people"' + attr('id', section.id) + attr('data-cols', cols || '') + attr('data-shape', shape) + '> '
    + when(eyebrow, () => '<p class="st-people-eyebrow">' + inlineHtml(eyebrow) + '</p>') + ' '
    + when(section.title, () => '<' + Title + '>' + inlineHtml(section.title) + '</' + Title + '>') + ' '
    + when(section.body, () => bodyHtml(section.body)) + ' '
    + groups.map((g) => {
      const cells = '<div class="st-people-cells"> ' + (g.people || []).map(person).join('') + ' </div>';
      return flat ? cells
        : '<div class="st-people-group"> <p class="st-people-group-head"' + attr('id', gid(g.title)) + '>' + inlineHtml(g.title) + '</p> '
          + when(g.lead, () => bodyHtml(g.lead)) + ' ' + cells + ' </div>';
    }).join('')
    + ' </section>';
}

function person(p) {
  const fi = firstImage(p.body);
  // round 4 (R3-P3-2): hoisted to a const — was three calls per person for the same destination,
  // each a separate drop-warning queue entry. round 3 (R2-P3-5): `p.href` is author Markdown, gated
  // by site-core.js's own `people` case via `isSafeHref`; `safeHref` shares that ONE policy here —
  // a `javascript:`/`data:` name link degrades to plain text.
  const pHrefOk = safeHref(p.href);
  return '<div class="st-person"' + attr('data-tone', p.tone || undefined) + '> '
    + when(fi.img, () => `<figure class="st-person-fig">${imgTag(fi.img.alt, fi.img.src)}</figure>`) + ' '
    + '<h3 class="st-person-name">  '
    + (pHrefOk
      ? '<a' + attr('href', pHrefOk) + attr('target', ext(pHrefOk) ? '_blank' : undefined) + attr('rel', ext(pHrefOk) ? 'noopener' : undefined) + '>' + inlineHtml(p.title) + '</a>'
      : inlineHtml(p.title))
    + ' </h3> '
    + when(p.badge, () => '<span class="st-person-roles"> '
      + roles(p.badge).map((x) => '<span class="st-person-role">' + text(x) + '</span>').join('') + ' </span>') + ' '
    + '<div class="st-person-body">' + bodyHtml(fi.rest) + '</div> '
    + when(p.links && p.links.length > 0, () => '<div class="st-person-links"> '
      + p.links.map((l) => {
        // round 4 (R3-P3-2): hoisted to a const — was three calls per link.
        const lHrefOk = safeHref(l.href);
        return lHrefOk
          ? '<a class="st-person-link"' + attr('href', lHrefOk) + attr('target', ext(lHrefOk) ? '_blank' : undefined) + attr('rel', ext(lHrefOk) ? 'noopener' : undefined) + '>' + text(l.label) + '</a>'
          : '<span class="st-person-link">' + text(l.label) + '</span>';
      }).join('') + ' </div>')
    + ' </div>';
}
