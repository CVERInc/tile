// The feed, and the two things a feed needs that this platform did not have: a complete channel,
// and a way to be FOUND.
//
// 🩸 A site had a valid RSS 2.0 feed at /rss.xml and not one page advertised it.
// WordPress and Blogger both emit `<link rel="alternate" type="application/rss+xml">` in the head of
// every page — that link is how a browser, a reader, and every aggregator discover a feed at all.
// Ours existed and was reachable only by someone who already knew the URL.
//
// The same round found `/feed` returning 404. That is the canonical WordPress feed path, so every
// subscriber a migrating site brings with it is pointed at a URL we answer with nothing — the
// sitemap regression again, in the one place where the loss is a named person who chose to follow.
//
// Pure and dependency-free on purpose: everything it needs is passed in, so a plain `node` test can
// reach it. The alias routes call the SAME builder as /rss.xml, so the two cannot drift into
// serving different feeds under different names.

// The icon rule is icon-core's (iconHrefs): the feed's <image> is the SAME PNG the apple-touch-icon
// <link> names, so the feed cannot claim a picture the build did not emit. Relative import on
// purpose — this module is plain-node (no Vite alias), and so is icon-core.
import { iconHrefs, ICON_PATHS } from '../../../icon-core.mjs';

/** Where this site's feed lives. One constant, referenced by the route, the aliases and the head. */
export const FEED_PATH = '/rss.xml';

/** The namespace Feedly reads `<webfeeds:icon>` from. */
export const WEBFEEDS_NS = 'http://webfeeds.org/rss/1.0';

/**
 * tile#177 — the absolute URL of the channel's <image>, or '' when none can be claimed.
 *
 * RSS 2.0 says an <image> is a GIF, JPEG or PNG, so the answer is the one raster every build
 * emits: icon-core's apple-touch-icon — the owner's own raster mark when they set one (`favicon:`
 * → `site-logo:` → `footer-logo:`, iconHrefs' order), else the generated badge at
 * /apple-touch-icon.png. An SVG or WebP mark falls back to the badge exactly as iOS does; a mark
 * with a scheme other than http(s) (the layout gates these through safeSrc) never reaches a
 * reader. No origin → no absolute URL → nothing, because a relative <image><url> is a broken
 * picture in every reader that fetched the feed through an alias or an aggregator.
 */
export function feedIcon(meta, origin = '') {
  const o = String(origin || '').replace(/\/$/, '');
  if (!o) return '';
  const hasPwa = String((meta && meta.packages) || '').split(/[\s,]+/).includes('pwa');
  const href = String(iconHrefs(meta || {}, { hasPwa }).appleTouch.href || '');
  const path = href.split(/[?#]/)[0].toLowerCase();
  const raster = /\.(?:png|jpe?g|gif)$/.test(path);
  if (!raster) return o + ICON_PATHS.apple;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('/') && !href.startsWith('//')) return o + href;
  return o + ICON_PATHS.apple;
}

/** The paths a feed reader might already be pointed at. `/feed` is WordPress's own; the Blogger one
 *  matches the /search/label routes this renderer already reproduces. Both serve the identical
 *  document — which is what WordPress does too (it answers /feed, /feed/rss2 and ?feed=rss2 alike). */
export const FEED_ALIASES = ['/feed', '/feeds/posts/default'];

const esc = (s) => String(s == null ? '' : s).replace(/[<>&'"]/g, (c) => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/**
 * Build an RSS 2.0 document.
 *
 * @param {object} o
 * @param {string} o.title        channel title, already resolved from the site
 * @param {string} o.link         channel link (the blog index), absolute when an origin is known
 * @param {string} o.description  channel description
 * @param {string} [o.language]   BCP-47 tag — WordPress emits this and readers group by it
 * @param {string} [o.selfUrl]    absolute URL of THIS document, for atom:link rel="self"
 * @param {Array}  o.items        [{ title, url, description, date, author }]
 * @param {string} [o.buildDate]  RFC-822 date for lastBuildDate; omitted when not supplied, because
 *                                a build clock this module invents would be a fact nobody measured
 * @param {string} [o.image]      absolute URL of the channel's PNG icon (see feedIcon); omitted
 *                                when not supplied. Emitted as RSS 2.0 <image> (title/link are the
 *                                channel's own, as the spec requires) AND <webfeeds:icon> (Feedly).
 */
export function feedXml({ title, link, description, language = '', selfUrl = '', items = [], buildDate = '', image = '' } = {}) {
  const body = items.map((it) => {
    const url = String(it.url || '');
    return `    <item>
      <title>${esc(it.title)}</title>
      <link>${url}</link>
      <guid>${url}</guid>
      ${it.date ? `<pubDate>${new Date(it.date).toUTCString()}</pubDate>` : ''}
      ${it.author ? `<dc:creator>${esc(it.author)}</dc:creator>` : ''}
      <description>${esc(it.description)}</description>
    </item>`;
  }).join('\n');

  // atom:link rel="self" is what tells an aggregator which URL this document IS — without it a feed
  // fetched through an alias looks like a second, unrelated feed.
  const head = [
    `    <title>${esc(title)}</title>`,
    `    <link>${esc(link)}</link>`,
    `    <description>${esc(description)}</description>`,
    language ? `    <language>${esc(language)}</language>` : '',
    buildDate ? `    <lastBuildDate>${esc(buildDate)}</lastBuildDate>` : '',
    selfUrl ? `    <atom:link href="${esc(selfUrl)}" rel="self" type="application/rss+xml" />` : '',
    // tile#177: the picture a reader shows beside the title. Channel-level, before any item.
    image ? `    <image>\n      <url>${esc(image)}</url>\n      <title>${esc(title)}</title>\n      <link>${esc(link)}</link>\n    </image>` : '',
    image ? `    <webfeeds:icon>${esc(image)}</webfeeds:icon>` : '',
  ].filter(Boolean).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:webfeeds="${WEBFEEDS_NS}"><channel>
${head}
${body}
</channel></rss>`;
}

/** The newest item date in RFC-822, or '' when the corpus has no usable date. Derived from the
 *  CONTENT rather than from the clock, so two builds of the same content produce the same bytes —
 *  a timestamp that moves on every build would defeat skip-unchanged uploading. */
export function latestBuildDate(items = []) {
  let best = null;
  for (const it of items) {
    const d = new Date(it && it.date);
    if (!isNaN(d) && (best === null || d > best)) best = d;
  }
  return best ? best.toUTCString() : '';
}
