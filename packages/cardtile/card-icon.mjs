// REEF with Card — the card's ICON SET (favicon + apple-touch-icon). Pure: zero I/O, no clock.
//
// 🩸 WHY THIS EXISTS (reef#1090, measured 2026-09-25). A Card's <head> named no icon at all, and on
// a creator's own domain `/favicon.ico` and `/apple-touch-icon.png` answered 200 with the WHOLE
// card page — 1.2 MB of HTML to every browser tab, link-preview crawler and iOS "Add to Home
// Screen", each of which then believed it had an icon. sitetile closed the same hole on 2026-08-28
// (packages/sitetile/icon-core.mjs); this is the Card following it, with the same rules:
//
//   · BORN-VALID. No opt-in: every card answers all three well-known paths with an image.
//   · The owner's picture wins. A card's picture is its profile avatar (the round `cp-icon` at the
//     top of the card), so that is what the tab shows. No avatar → icon-core's initial badge, drawn
//     by icon-core itself. The badge is NOT re-implemented here; a second copy is how two halves
//     of one product end up drawing two different badges.
//   · ONE rel=icon. An avatar card links the avatar and only the avatar, for the reason icon-core
//     gives: two rel=icon links let each browser pick which brand a visitor sees.
//
// 🔴 THE apple-touch-icon IS THE ONE PLACE THE AVATAR CAN LOSE. iOS takes a PNG there — not SVG, not
// webp — and an avatar is almost always webp: assets/embed.mjs and both editors encode to webp at
// ingest. Re-encoding webp → PNG at the edge means decoding VP8, which is a native image library
// (or a JS port of one) on every card request; icon-core refuses that for the same reason and so
// does this. So the home-screen icon is the avatar when the avatar asset IS a PNG, and otherwise
// the card's own badge PNG — the honest floor, not a screenshot of the page.
//
// reef#1092 closed most of that gap without moving the rule: the PNG is now MADE AT INGEST, beside
// the avatar (card-core's rasterCopyId — `<avatar id>.png`), and this file only picks it up. A card
// whose avatar predates the copy still gets the badge, until assets/backfill-raster.mjs is run on it.
import { ICON_PATHS, markType, badgeSvg, appleTouchPngWeb, faviconIcoWeb } from '../sitetile/icon-core.mjs';
import { rasterCopyId } from './card-core.js';

export { ICON_PATHS };

/** The asset types the icon routes will serve as-is. 🔴 Not image/svg+xml: an SVG served from the
 *  card's own origin is a document that can carry script, and the asset lane is author-controlled.
 *  Anything else in `mime=` (text/html, say) is not an image, so it is not an avatar here. */
const RASTER = /^image\/(png|jpeg|webp|gif|avif)$/;
const B64 = /^[A-Za-z0-9+/=\s]+$/;

/**
 * The card's avatar: the FIRST profile cell's `avatar=`, as the card renders it.
 *   → { mime, b64 }  a picture in the card's own `## assets` lane
 *   → { url }        an http(s) picture somewhere else
 *   → null           no avatar, or one that does not resolve to a raster image
 */
export function cardAvatar(model) {
  const cell = ((model && model.cells) || []).find((c) => c && c.type === 'profile');
  const raw = String((cell && cell.params && cell.params.avatar) || '').trim();
  if (!raw) return null;
  const m = /^asset:(.+)$/.exec(raw);
  if (m) {
    const a = model.assets && model.assets[m[1].trim()];
    const mime = String((a && a.mime) || '').toLowerCase();
    // …and the body must be base64 and nothing else: it is spliced into an SVG attribute below.
    return a && a.b64 && RASTER.test(mime) && B64.test(a.b64) ? { id: m[1].trim(), mime, b64: a.b64 } : null;
  }
  return /^https?:\/\//i.test(raw) ? { url: raw } : null;
}

/**
 * The avatar as a PNG, if the card has one: its raster copy, else the avatar itself when it already
 * IS a PNG. → { mime: 'image/png', b64, width, height } | null. This one file is both the card's
 * og:image and its apple-touch-icon (card-share.mjs): both want a PNG of the owner's picture, so
 * two copies would only be two chances to disagree.
 *
 * 🔴 The copy is believed only when its bytes say PNG — the `mime=` is author-controlled and the
 * route serves it with nosniff under a `.png` name. Width/height are read off the IHDR chunk (no
 * decoding), and a PNG without a readable IHDR is not used at all.
 */
export function cardRaster(model) {
  const av = cardAvatar(model);
  if (!av || !av.mime) return null;
  const copy = model.assets && model.assets[rasterCopyId(av.id)];
  const pick = copy && copy.b64 && B64.test(copy.b64) ? copy.b64 : av.mime === 'image/png' ? av.b64 : null;
  const dims = pick ? pngSize(pick) : null;
  return dims ? { mime: 'image/png', b64: pick, ...dims } : null;
}

/** A PNG's width × height from its IHDR, or null when these are not PNG bytes. Decodes 32 base64
 *  chars (24 bytes), never the image. */
export function pngSize(b64) {
  let head;
  try { head = atob(String(b64).replace(/\s+/g, '').slice(0, 32)); } catch { return null; }
  if (head.length < 24 || head.slice(0, 8) !== '\x89PNG\r\n\x1a\n' || head.slice(12, 16) !== 'IHDR') return null;
  const u32 = (o) => ((head.charCodeAt(o) << 24) | (head.charCodeAt(o + 1) << 16) | (head.charCodeAt(o + 2) << 8) | head.charCodeAt(o + 3)) >>> 0;
  const width = u32(16), height = u32(20);
  return width && height ? { width, height } : null;
}

/** What icon-core's badge reads, in the Card's own words: the card's name, its accent. */
export const badgeMeta = ({ name, accent } = {}) => ({ brand: name || '', 'icon-color': accent || '' });

/**
 * Where this card's three files live. On a creator's own domain the card IS the root, so they are
 * the well-known root paths; on the shared canonical host `/favicon.ico` belongs to nobody, so they
 * sit under the card's own path (`/<handle>/favicon.ico`). Read off cardUrl, which is the one place
 * that already knows which of the two this request is. No cardUrl (a preview, an editor frame) →
 * null: there is no address to point at.
 */
export function iconBase(cardUrl) {
  if (!cardUrl) return null;
  try { return new URL(cardUrl).pathname.replace(/\/+$/, ''); } catch { return null; }
}

/** The <link> tags' attributes for <head>, in order. [] when there is nowhere to point. */
export function iconLinks(model, { cardUrl } = {}) {
  const base = iconBase(cardUrl);
  if (base == null) return [];
  const av = cardAvatar(model);
  const icon = av && av.mime ? [{ rel: 'icon', type: av.mime, href: base + ICON_PATHS.ico }]
    : av && av.url ? [{ rel: 'icon', type: markType(av.url), href: av.url }]
      : [{ rel: 'icon', sizes: '32x32', href: base + ICON_PATHS.ico },
        { rel: 'icon', type: 'image/svg+xml', href: base + ICON_PATHS.svg }];
  return [...icon, { rel: 'apple-touch-icon', href: base + ICON_PATHS.apple }];
}

/** '/favicon.ico' | '/favicon.svg' | '/apple-touch-icon.png' → which file, or null. */
export function iconKind(path) {
  for (const [k, p] of Object.entries(ICON_PATHS)) if (path === p) return k;
  return null;
}

const b64bytes = (b64) => Uint8Array.from(atob(String(b64).replace(/\s+/g, '')), (c) => c.charCodeAt(0));

/**
 * One file: kind ∈ ico | svg | apple → { body, type }. Async only because the badge's PNG deflate is
 * the platform's CompressionStream (the Worker has no node:zlib).
 *
 *   avatar in the card   ico   → the avatar's own bytes, its own type
 *                        svg   → an SVG holding the avatar (the file is an SVG by name and by type)
 *                        apple → the avatar's PNG (cardRaster: its copy, or itself if a PNG),
 *                                else the badge PNG (see the header)
 *   no avatar, or one    ico   → the badge, 32×32 PNG-in-ICO
 *   hosted elsewhere     svg   → the badge SVG
 *                        apple → the badge PNG, 180×180
 * 🔴 An avatar hosted elsewhere is linked from <head> but never FETCHED here: that would make these
 * routes an open door to whatever URL a card names. The files fall to the badge instead.
 */
export async function iconFile(kind, model, meta) {
  const av = cardAvatar(model);
  const own = av && av.mime ? av : null;
  if (kind === 'ico') {
    return own ? { body: b64bytes(own.b64), type: own.mime } : { body: await faviconIcoWeb(badgeMeta(meta)), type: 'image/x-icon' };
  }
  if (kind === 'svg') {
    const body = own
      ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">'
        + `<image width="64" height="64" preserveAspectRatio="xMidYMid slice" href="data:${own.mime};base64,${own.b64}"/></svg>\n`
      : badgeSvg(badgeMeta(meta));
    return { body, type: 'image/svg+xml' };
  }
  if (kind === 'apple') {
    const png = cardRaster(model);
    return png ? { body: b64bytes(png.b64), type: 'image/png' }
      : { body: await appleTouchPngWeb(badgeMeta(meta)), type: 'image/png' };
  }
  return null;
}
