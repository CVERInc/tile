// The ONE way a post card writes its image — blog index, term/date archives, both tag-label pages,
// "Keep reading" / related cards, the `posts=N` carousel and the archive island that rebuilds the
// list in the browser.
//
// 🩸 Every one of those used to write its own bare lazy `<img>` of the post image, so a post's
// first image went out at its original size (1280–2048px) into a ~360px card: no width/height (the
// layout shifts as each one arrives), no `sizes`, no srcset, and seven places to fix it in.
//
// What this writes, and what it refuses to make up:
//   loading="lazy" decoding="async"   always.
//   sizes                             always, from the layout's real width in the engine's own CSS
//                                     (CARD_SIZES below). It is inert without srcset, and is here so
//                                     derivatives only have to add srcset.
//   width / height                    only when the caller KNOWS the intrinsic size (a local file the
//                                     build read the header of). A remote image gets neither — a
//                                     guessed size is worse than none: it reserves the wrong box.
//   srcset                            only when real derivatives are handed in. This module never
//                                     builds a resize URL itself.
//   src                               the post's image, unchanged — so a site with no derivatives
//                                     renders exactly as before apart from the added attributes.
//
// 🔴 `src` must already be gated. Every caller passes `post.image`, which parsePost gates once with
// safeSrc. This module stays dependency-free on purpose: the archive island imports it into a
// browser bundle, and importing site-core here would ship the whole model to every visitor.

/** The rendered width of a card image, per layout, as the engine's own CSS lays it out.
 *  - `list`: index / archive / tag-label / keep-reading cards. The engine's floor gives the card the
 *    whole list column (site.css sets no card width; a theme narrows it), so the honest bound is the
 *    viewport.
 *  - carousel: `.st-car-cell` is `calc(100% / N - 8px)` of a track no wider than the viewport. */
export const CARD_SIZES = Object.freeze({ list: '100vw' });

/** The columns a carousel actually lays out: site.css has rules for 2/3/4, maps 6 to 5, and every
 *  other value (absent included) falls through to the default 5. */
export function carouselCols(cols) {
  const n = String(cols ?? '').trim();
  return n === '2' || n === '3' || n === '4' ? Number(n) : 5;
}

export function cardSizes(layout, cols) {
  if (layout === 'carousel') return `calc(100vw / ${carouselCols(cols)})`;
  if (layout === 'list') return CARD_SIZES.list;
  throw new Error(`cardSizes: unknown card layout '${layout}'`);
}

const posInt = (v) => (Number.isInteger(v) && v > 0 ? v : null);

/** `[{ src, width }]` → a srcset value, or '' when there is no usable derivative. */
function srcsetOf(derivatives) {
  if (!Array.isArray(derivatives)) return '';
  const ok = derivatives.filter((d) => d && typeof d.src === 'string' && d.src && !/[\s,]/.test(d.src) && posInt(d.width));
  return ok.map((d) => `${d.src} ${d.width}w`).join(', ');
}

/**
 * The attributes of one card image, in emission order, as a plain object (an Astro template spreads
 * it; the island sets each one; cardImg below serialises it). null when there is no src.
 * @param {{ src: string, cls: string, layout: 'list'|'carousel', cols?: unknown, width?: number,
 *           height?: number, alt?: string, derivatives?: Array<{ src: string, width: number }> }} o
 */
export function cardImgAttrs(o) {
  if (!o || typeof o.src !== 'string' || !o.src) return null;
  const out = {};
  if (o.cls) out.class = o.cls;
  out.src = o.src;
  const srcset = srcsetOf(o.derivatives);
  if (srcset) out.srcset = srcset;
  out.sizes = cardSizes(o.layout, o.cols);
  const w = posInt(o.width), h = posInt(o.height);
  if (w && h) { out.width = String(w); out.height = String(h); }
  out.alt = typeof o.alt === 'string' ? o.alt : '';
  out.loading = 'lazy';
  out.decoding = 'async';
  return out;
}

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** The same image as an HTML string, for emitters that write strings (emit/carousel.mjs). '' when
 *  there is no src. Escapes exactly as emit/html.mjs `attr` (and Astro's addAttribute) do. */
export function cardImg(o) {
  const a = cardImgAttrs(o);
  if (!a) return '';
  return '<img' + Object.entries(a).map(([k, v]) => ' ' + k + '="' + esc(v) + '"').join('') + '>';
}
