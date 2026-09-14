// The square-shop cart badge — ONE implementation, shared as SOURCE.
//
// The header badge is painted on EVERY page of a wired site and is the number a shopper checks
// their basket against. It had THREE implementations: sitetile's header island, the product
// detail page's own inline script, and a copy in a test that was asserting about the other two.
// They agreed on the day they were measured, which is the only thing three copies of an algorithm
// ever guarantee — and the review that found them (round 3, P3-4) said the part that matters: the
// whole point of this area is "the badge counts what the checkout will carry", and a ruler copied
// from the thing it measures drifts WITH it, silently, while the test stays green.
//
// 🔴 TWO of the three consumers cannot import this file, and that is structural, not laziness:
//
//   · `../square-shop/square-shop.js` is published as a RAW artifact (dynamic-corals/build.mjs
//     stamps it and never bundles it) and is vendored into feelreef unmodified.
//   · `../square-shop/product-page-core.js` is CONCATENATED into every site's `dist/_worker.js`
//     by emit-shop-function.mjs, whose whole contract is "both source files are ES modules with
//     no imports, so concatenation yields one valid module". An import there breaks every site.
//
// So they carry a MIRROR, and ./cart-badge-count.test.mjs asserts the mirrored text is this
// module's own `Function.prototype.toString()` output, character for character — the same
// arrangement, for the same reason, as ./close-button.mjs and the QR coral. sitetile's
// `header-actions-cart.js` is bundled by Vite and DOES import this, so the one consumer that can
// have the real thing has it.
//
// The functions are one-liners on purpose: a mirror that has to survive being pasted at two
// different indentation levels can only be pinned byte for byte if it occupies one line.

/**
 * The quantity a stored cart row means.
 *
 * A row is `[variationId, qty]`. 0.11.15 briefly wrote `[variationId, 0, qty]` for a row it could
 * not confirm, and its own Add button could turn that into `[variationId, 1, qty]`; in both the
 * shopper's real quantity is the LARGER of the two numbers, and a third slot never meant anything
 * else. Clamped to 1..99, the same bounds square-shop.js's stepper enforces — a row that is on
 * disk at all stands for at least one item, which is what keeps this number equal to the one the
 * checkout POST will carry.
 */
export function cartRowQty(e) { if (!Array.isArray(e)) return 0; const a = parseInt(e[1], 10) || 0, b = e.length > 2 ? (parseInt(e[2], 10) || 0) : 0, q = a > b ? a : b; return q < 1 ? 1 : (q > 99 ? 99 : q); }

/**
 * The badge number for a parsed basket.
 *
 * `held` is the variation ids the page currently knows to be UNSELLABLE — derived per page load
 * from the catalog in hand and published by square-shop.js on its mount as `data-cart-held`.
 * Nothing on disk says which rows those are, deliberately (see that file's storage comment).
 *
 * A caller with no held set — the product detail page, a page with no coral on it, an OLDER coral
 * that publishes no attribute — passes none and counts every row. That is an OVER-count while a
 * row is held, never an under-count, and never a charge: the POST is built from the confirmed
 * rows alone.
 *
 * Rows this basket's writers do not understand (a non-array, an array with no id) count zero,
 * which is also exactly what they contribute to the checkout.
 */
export function cartBadgeCount(entries, held) { if (!Array.isArray(entries)) return 0; const skip = Array.isArray(held) ? held.map(String) : []; let n = 0; for (const e of entries) { if (!Array.isArray(e)) continue; const vid = String(e[0] || ''); if (!vid || skip.indexOf(vid) >= 0) continue; n += cartRowQty(e); } return n; }
