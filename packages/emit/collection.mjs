// `collection` — a list of items, optionally grouped by category, with category jump-pills.
// General: catalogs, portfolios, team pages, tag lists. Mirrors the reference renderSection
// 'collection' case.
// IR: `## title` + `%% sitetile: collection eyebrow="..." link="label"→href %%` + intro body,
// then `### Category` groups each holding `#### name →href "badge"` item cards.
// Layout: a HEAD (title + intro + link) on the page field, then a full-bleed BELT
// (eyebrow + jump-pills + grouped cards). The <section> is `st-full-bleed` (opts out of site.css's
// generic section floor) so the belt's background can be a band; head and belt inset their own box.
//
// Markdown is the CALLER's dialect (tile-lab#52 ruling 2026-10-31): `ctx.inline` / `ctx.block`.
// The belt eyebrow, the badges, the tags and the link label are plain text — they always were.
import { slugify, safeHref } from '../sitetile/site-core.js';
import { attr, text, when } from './html.mjs';
import { signetArrow } from './arrow.mjs';

const GH_PATH = '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>';
const ghSvg = (cls, px) => '<svg class="' + cls + '" width="' + px + '" height="' + px + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + GH_PATH + '</svg>';
const gid = (t) => 'group-' + slugify(t, 'g');
const isGh = (h) => /github\.com/.test(h || '');
const isExternal = (h) => /^https?:\/\//.test(h || '');
// external links open in a new tab (rel=noopener), same rule as every other button surface
// (design 2026-07-13). Internal links (learn pages, anchors) stay in the same tab.
const tgt = (h) => attr('target', isExternal(h) ? '_blank' : undefined) + attr('rel', isExternal(h) ? 'noopener' : undefined);
const badges = (b) => String(b || '').split('·').map((s) => s.trim()).filter(Boolean);

/**
 * @param {{ eyebrow?: unknown, link: { label: string, href: string } | null,
 *           ui: { updated: (x: string) => string, gh: string, learn: string } }} params
 *   `ui` is the host's meta-row chrome for the page's locale (word order differs per locale, so
 *   `updated` is a function, not a label).
 * @param {{ hero?: boolean, inline: (md: string) => string, block: (md: string) => string }} ctx
 */
export function emitCollection(section, params, ctx) {
  const { eyebrow, link, ui: UI } = params;
  const Title = ctx.hero ? 'h1' : 'h2';       // first section on the page → <h1> (page hero heading)
  const CardTitle = ctx.hero ? 'h2' : 'h3';   // card titles sit ONE level below the section title
  const groups = section.groups || [];
  const multi = groups.length > 1;
  // `link.href` (head link), `it.href`/`it.learn` (per-item destinations) are author Markdown;
  // site-core.js's own `collection` case gates every one on `isSafeHref` (and gates `it.href` on
  // ITSELF, not on `it.learn` — R2-P1-1). `safeHref` shares that ONE policy. Head link first.
  const linkHrefOk = link ? safeHref(link.href) : null;
  return '<section class="st-collection st-full-bleed"' + attr('id', section.id) + '> '
    + '<div class="st-collection-head">  <div class="st-collection-head-inner"> '
    + when(section.title, () => '<' + Title + '>' + ctx.inline(section.title) + '</' + Title + '>') + ' '
    + when(section.body, () => ctx.block(section.body)) + ' '
    + when(link, () => (linkHrefOk
      ? '<a' + attr('class', `st-collection-link${isGh(linkHrefOk) ? ' st-collection-link-gh' : ''}`) + attr('href', linkHrefOk) + tgt(linkHrefOk) + '> '
        + when(isGh(linkHrefOk), () => ghSvg('st-gh-icon', 16)) + ' <span>' + text(link.label) + '</span> '
        + signetArrow(isExternal(linkHrefOk) ? 'up-right' : 'right', 16) + ' </a>'
      : '<span class="st-collection-link"><span>' + text(link.label) + '</span></span>'))
    + ' </div> </div> <div class="st-collection-belt"> <div class="st-collection-belt-inner"> '
    + when(eyebrow, () => '<p class="st-collection-eyebrow">' + text(eyebrow) + '</p>') + ' '
    + when(multi, () => '<nav class="st-collection-pills" aria-label="Categories"> '
      + groups.map((g) => '<a class="st-collection-pill"' + attr('href', `#${gid(g.title)}`) + '>' + ctx.inline(g.title) + '</a>').join('')
      + ' </nav>') + ' '
    + groups.map((g) => '<div class="st-collection-group"> <p class="st-collection-group-head"' + attr('id', gid(g.title)) + '>' + ctx.inline(g.title) + '</p> '
      + '<div class="st-cells"> ' + (g.items || []).map((it) => item(it, CardTitle, UI, ctx)).join('') + ' </div> </div>').join('')
    + ' </div> </div> </section>';
}

function item(it, CardTitle, UI, ctx) {
  // Primary destination mirrors the real source: the learn page if present, else the GitHub URL.
  const primaryHref = it.learn || it.href;
  const primaryHrefOk = primaryHref ? safeHref(primaryHref) : null;
  const ghOk = it.href ? safeHref(it.href) : null;
  const learnOk = it.learn ? safeHref(it.learn) : null;
  // "View on GitHub" is its own <a> only when the card ALSO has a learn page (the cover link then
  // points to learn); without one the whole card already links to GitHub, so it is plain text.
  const ghInner = () => ghSvg('st-item-gh-icon', 12) + text(UI.gh) + ' ' + signetArrow('up-right', 12);
  return '<div class="st-cell st-item"> '
    + when(primaryHrefOk, () => '<a class="st-item-cover"' + attr('href', primaryHrefOk) + tgt(primaryHrefOk) + attr('aria-label', it.title) + '></a>') + ' '
    + '<div class="st-item-head"> <' + CardTitle + '>' + ctx.inline(it.title) + '</' + CardTitle + '> '
    + when(it.badge, () => '<span class="st-item-badges">' + badges(it.badge).map((x) => '<span class="st-item-badge">' + text(x) + '</span>').join('') + '</span>')
    + ' </div> ' + ctx.block(it.body) + ' '
    + when(it.tags && it.tags.length > 0, () => '<div class="st-item-tags"> ' + it.tags.map((x) => '<span class="st-item-tag">' + text(x) + '</span>').join('') + ' </div>') + ' '
    + when(it.href || it.learn, () => '<div class="st-item-meta"> <div class="st-item-meta-left"> '
      + when(it.updated, () => '<span class="st-item-updated">' + text(UI.updated(it.updated)) + '</span>') + '  '
      + when(it.updated && it.href && it.learn, () => '<span class="st-item-sep" aria-hidden="true">|</span>') + ' '
      + when(it.href, () => ((ghOk && learnOk)
        ? '<a class="st-item-gh"' + attr('href', ghOk) + tgt(ghOk) + '>' + ghInner() + '</a>'
        : '<span class="st-item-gh">' + ghInner() + '</span>'))
      + ' </div> '
      + when(learnOk, () => '<a class="st-item-learn"' + attr('href', learnOk) + '>' + text(UI.learn) + ' ' + signetArrow('right', 12) + '</a>')
      + ' </div>')
    + ' </div>';
}
