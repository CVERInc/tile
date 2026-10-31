// `hero` — the page-opening band, in three shapes: the legacy hero (h1 + body + one `cta=`), an
// opt-in columned `layout=` hero (split / bubble: eyebrow, lead, a button row, side art, an
// optional word marquee), and an opt-in `layers=` depth hero (stacked images, optional logo h1).
// Mirrors the reference renderSection 'hero' case.
//
// 🔴 `parallax` is a dynamic coral (packages/dynamic-corals/hero-parallax). This function writes
// only its mount point — `data-dynamic-coral="hero-parallax"` on a layered hero that opted in — and
// the host loads the coral script (sitetile: Hero.astro's <script> import).
//
// Markdown is the CALLER's dialect (tile-lab#52 ruling 2026-10-31): `ctx.inline` / `ctx.block`.
import { ctaHtml, heroParts, linkButtonsHtml, safeSrc, cssUrlString } from '../sitetile/site-core.js';
import { attr, text, when } from './html.mjs';

/**
 * @param {{ media: 'logo' | 'avatar', layout: string | null, eyebrow?: unknown, marqueeWords: string[],
 *           enter: boolean, layerList: string[], parallax: boolean, logo: string | null, logoPos: string,
 *           cta?: unknown, bgOk: string | null }} params
 *   `bgOk` / `logo` arrive already gated by `safeSrc`.
 * @param {{ inline: (md: string) => string, block: (md: string) => string }} ctx
 */
export function emitHero(section, params, ctx) {
  const { media, layout, eyebrow, marqueeWords, enter, layerList, parallax, logo, logoPos, cta, bgOk } = params;
  // A SAFE destination still isn't a SAFE `url()` token: `cssUrlString` quotes it and CSS-escapes
  // the two characters a quoted CSS string treats specially (round 5, R4-P3-6).
  const style = bgOk ? `background-image:url("${cssUrlString(bgOk)}")` : undefined;
  const eyebrowP = () => when(eyebrow, () => '<p class="st-hero-eyebrow">' + ctx.inline(eyebrow) + '</p>');
  const h1 = () => (logo
    ? '<h1 class="st-hero-logo"><img' + attr('src', logo) + attr('alt', section.title) + ' loading="eager" decoding="async"></h1>'
    : '<h1>' + ctx.inline(section.title) + '</h1>');
  // `layers=` / `heroParts`' images are author-controlled `src` destinations: each one is gated by
  // `safeSrc` here (one call per image, in order), and a disallowed one renders nothing.
  const img = (cls, src, alt, extra) => {
    const srcOk = safeSrc(src);
    return when(srcOk, () => '<img class="' + cls + '"' + attr('src', srcOk) + alt + extra + ' loading="eager" decoding="async">');
  };

  if (layerList.length) {
    return '<section class="st-hero st-full-bleed st-hero-layered"' + attr('id', section.id) + attr('data-media', media)
      + attr('data-parallax', parallax ? '' : undefined) + attr('data-logo-pos', logoPos) + attr('data-enter', enter ? '' : undefined)
      + attr('data-dynamic-coral', parallax ? 'hero-parallax' : undefined) + '> '
      + '<div class="st-hero-stage" aria-hidden="true"> '
      + layerList.map((src, i) => img('st-hero-layer', src, ' alt=""', attr('data-depth', i))).join('')
      + ' </div> <div class="st-hero-text st-hero-overlay"> '
      + eyebrowP() + ' ' + h1() + ' ' + ctx.block(section.body) + ' ' + ctaHtml(cta, 'st-hero-cta')
      + ' </div> </section>';
  }
  if (layout) {
    const hp = heroParts(section.body);
    return '<section class="st-hero st-full-bleed"' + attr('id', section.id) + attr('data-media', media) + attr('data-layout', layout) + attr('style', style) + '> '
      + when(marqueeWords.length > 0, () => '<div class="st-hero-marquee" aria-hidden="true"> '
        + marqueeWords.map((w, i) => '<div class="st-hero-marquee-row"' + attr('data-dir', i % 2 ? 'rev' : 'fwd') + '> <div class="st-hero-marquee-track"> '
          + Array.from({ length: 12 }).map(() => '<span>' + text(w) + '</span>').join('') + ' </div> </div>').join('')
        + ' </div>') + ' '
      + '<div' + attr('class', layout === 'bubble' ? 'st-hero-bubble' : 'st-hero-text') + '> '
      + eyebrowP() + ' ' + h1() + ' ' + ctx.block(hp.text) + ' '
      + (hp.buttons.length ? linkButtonsHtml(hp.buttons, 'st-hero') : ctaHtml(cta, 'st-hero-cta'))
      + ' </div> '
      + when(hp.images.length > 0, () => '<div class="st-hero-art"' + attr('data-imgs', hp.images.length > 1 ? String(hp.images.length) : undefined) + '> '
        + hp.images.map((im) => img('st-img', im.src, attr('alt', im.alt), '')).join('') + ' </div>')
      + ' </section>';
  }
  return '<section class="st-hero st-full-bleed"' + attr('id', section.id) + attr('data-media', media) + attr('data-enter', enter ? '' : undefined) + attr('style', style) + '> '
    + when(enter && bgOk, () => '<div class="st-hero-bg" aria-hidden="true"' + attr('style', style) + '></div>') + ' '
    + '<h1>' + ctx.inline(section.title) + '</h1> ' + ctx.block(section.body) + ' ' + ctaHtml(cta, 'st-hero-cta')
    + ' </section>';
}
