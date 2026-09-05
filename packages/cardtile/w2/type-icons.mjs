// One icon per Card cell type, for the one-row picker 「＋加一張牌」 opens.
//
// 🔴 NEW, because the engine has none of these. `hosts/web/tugtile/icons.js` carries the authentic
// Lucide bodies the plugin's own `setIcon` draws — undo, fold, search, the lane menu — and every
// one of them is about a BOARD. A Card's seven kinds (a profile, a link, a picture, prose, a video,
// a social row, a slideshow) are this product's vocabulary and the engine has never heard of them.
// Reusing an icon set is not the same as reusing an icon that does not exist.
//
// Same drawing contract as the engine's: 24×24 viewBox, `fill=none`, `stroke=currentColor`,
// stroke-width 2, round caps and joins — so a Card icon and a tugtile icon sit in the same row
// without one of them looking imported.
export const TYPE_ICONS = {
  // a person
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1"/>',
  // a chain link
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  // a framed picture — the `feature` type IS "a picture with a caption"
  feature: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L3 21"/>',
  // prose
  text: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/>',
  // play
  video: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m10 9 5 3-5 3z"/>',
  // a row of dots joined — the social row
  social: '<circle cx="5" cy="12" r="2.5"/><circle cx="12" cy="12" r="2.5"/><circle cx="19" cy="12" r="2.5"/>',
  // stacked frames — the slideshow
  embed: '<rect x="7" y="3" width="14" height="14" rx="2"/><path d="M3 7v12a2 2 0 0 0 2 2h12"/>',
};

/** the icon body for a type, or a neutral square for one this table has not met */
export const typeIcon = (type) => TYPE_ICONS[type] || '<rect x="4" y="4" width="16" height="16" rx="2"/>';

/** a complete `<svg>` for a type, sized by its container's font-size */
export const typeIconSvg = (type) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"'
  + ' stroke-linejoin="round" aria-hidden="true">' + typeIcon(type) + '</svg>';
