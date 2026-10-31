// The string form of `@cvernet/signet/Arrow.astro` — the directional arrow whose tail retracts on
// hover (`@cvernet/signet/arrow.css` does the morph). Byte-for-byte what that component renders
// with compressHTML on, so an emitter that calls this gives the page the bytes `<Arrow>` gave it.
//
// Not site-core's `arrowSvg`: that one is the reference renderer's approximation (no inter-node
// spaces, a self-closed `<polyline/>`), and the built page has always carried the component's
// spelling. section-contract compares structure, not text, which is why the two could differ.
import { attr } from './html.mjs';

/**
 * @param {'right' | 'left' | 'up-right'} [direction]
 * @param {number} [size]  px; the component's default is 16
 */
export function signetArrow(direction = 'right', size = 16) {
  const dir = direction === 'left' ? ' signet-arrow--left' : direction === 'up-right' ? ' signet-arrow--up-right' : '';
  return '<span class="signet-arrow' + dir + '"' + attr('style', `width:${size}px;height:${size}px;--signet-arrow-w:${size}px`)
    + ' aria-hidden="true"> <span class="signet-arrow__tail"></span> <svg class="signet-arrow__head"' + attr('width', size) + attr('height', size)
    + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"> <polyline points="10 6 16 12 10 18"></polyline> </svg> </span>';
}
