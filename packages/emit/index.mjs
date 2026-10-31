// The shared section emitter (tile-lab#52): one pure function per section, `(section, params, ctx)
// → HTML string`. No Astro, no DOM, no I/O — sitetile's `.astro` components call it through
// `set:html`, and a Worker can call the same function. See README.md for the call shape.
export { text, attr, boolAttr, when } from './html.mjs';
export { emitEmbed } from './embed.mjs';
export { emitSocial } from './social.mjs';
export { emitTagcloud } from './tagcloud.mjs';
export { emitProse } from './prose.mjs';
export { emitFaq } from './faq.mjs';
export { emitLinks } from './links.mjs';
export { emitTimeline } from './timeline.mjs';
export { emitGallery } from './gallery.mjs';
export { emitPeople } from './people.mjs';
export { signetArrow } from './arrow.mjs';
export { emitGrid, gridCell, gridFacets } from './grid.mjs';
export { emitCollection } from './collection.mjs';
export { emitHero } from './hero.mjs';
export { emitCarousel } from './carousel.mjs';
export { emitForm } from './form.mjs';
