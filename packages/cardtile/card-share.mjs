// REEF with Card — what a LINK PREVIEW reads: og:*, twitter:*, <meta name=description>, canonical.
// Pure: zero I/O, no clock.
//
// 🩸 WHY THIS EXISTS (reef#1092, measured 2026-09-25). A Card is the link a creator puts in a bio
// and sends to people, so every share of it is a link preview — and its <head> carried no og:*, no
// twitter:*, no description. LINE, iMessage, Facebook and Threads showed a bare URL or a title,
// never the creator's face. sitetile's SiteLayout has emitted these since 2026-07; this is the Card
// catching up, with the same semantics:
//
//   · ABSENT → OMITTED. No tagline, no description tags. No picture, no og:image. A tag is never
//     filled with something the card did not say.
//   · og:url and canonical are the card's own public address (cardUrl). No cardUrl — a preview, an
//     editor frame — means no address to claim, so none of this is emitted there (card-icon's rule).
//
// 🔴 og:image IS THE AVATAR OR NOTHING. It is card-icon's cardRaster — the avatar's PNG copy, or the
// avatar itself when it is a PNG — served from the apple-touch-icon path, because it is the same
// file with the same job: "this card's picture, as a PNG". A card without one (no avatar, or a webp
// avatar from before the copy existed) emits NO og:image rather than the initial badge. A badge in a
// share preview reads as the creator's chosen image and is not; the crawlers that want an icon for
// a link without og:image already find the apple-touch-icon <link>, which does carry the badge.
//
// twitter:card is `summary`, never `summary_large_image`: the picture is a square avatar, and the
// large card crops to 2:1 — it would cut the face in half.
import { cardAvatar, cardRaster, iconBase, ICON_PATHS } from './card-icon.mjs';
import { markType } from '../sitetile/icon-core.mjs';

/** How long a description may run. Google shows ~155–160 characters; counted in code points, so a
 *  Chinese tagline gets the same number of characters an English one does. */
export const DESCRIPTION_MAX = 160;

/**
 * The profile tagline as plain text: the markdown the card renders (links, bold, italic) reduced to
 * its words, any HTML tags dropped, whitespace collapsed, cut at DESCRIPTION_MAX with an ellipsis.
 */
export function describe(model) {
  const cell = ((model && model.cells) || []).find((c) => c && c.type === 'profile');
  const text = String((cell && cell.body) || '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const cps = [...text];
  return cps.length <= DESCRIPTION_MAX ? text : cps.slice(0, DESCRIPTION_MAX - 1).join('').trimEnd() + '…';
}

/**
 * The card's share picture → { url, type, width?, height? } | null.
 *   avatar in the card with a PNG (copy or itself) → the apple-touch-icon path, absolute
 *   avatar hosted elsewhere as png/jpeg             → that URL as-is (a crawler fetches it itself;
 *                                                     this Worker never does — see card-icon)
 *   anything else                                   → null: no og:image (see the header)
 */
export function shareImage(model, { cardUrl } = {}) {
  const base = iconBase(cardUrl);
  if (base == null) return null;
  const png = cardRaster(model);
  if (png) return { url: new URL(base + ICON_PATHS.apple, cardUrl).href, type: 'image/png', width: png.width, height: png.height };
  const av = cardAvatar(model);
  const t = av && av.url ? markType(av.url) : '';
  return /^https:\/\//i.test((av && av.url) || '') && (t === 'image/png' || t === 'image/jpeg') ? { url: av.url, type: t } : null;
}

/**
 * Everything for <head>: { canonical, meta: [{ attr: 'name'|'property', key, content }] } in the
 * order they are emitted. Without cardUrl: { canonical: '', meta: [] }.
 */
export function shareTags(model, { name, cardUrl } = {}) {
  if (iconBase(cardUrl) == null) return { canonical: '', meta: [] };
  const title = String(name || '').trim();
  const description = describe(model);
  const img = shareImage(model, { cardUrl });
  const meta = [];
  const add = (attr, key, content) => { if (content !== '' && content != null) meta.push({ attr, key, content: String(content) }); };
  add('name', 'description', description);
  add('property', 'og:type', 'website');
  add('property', 'og:title', title);
  add('property', 'og:description', description);
  add('property', 'og:url', cardUrl);
  if (img) {
    add('property', 'og:image', img.url);
    add('property', 'og:image:type', img.type);
    add('property', 'og:image:width', img.width);
    add('property', 'og:image:height', img.height);
    add('property', 'og:image:alt', title);
  }
  add('name', 'twitter:card', 'summary');
  add('name', 'twitter:title', title);
  add('name', 'twitter:description', description);
  if (img) add('name', 'twitter:image', img.url);
  return { canonical: cardUrl, meta };
}
