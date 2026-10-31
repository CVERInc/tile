// The capabilities a WordPress site has on the day it is installed.
//   run: node packages/sitetile/discoverability.test.mjs
//
// 🩸 2026-08-06, second audit round, with the bar set at "what WordPress ships out of the box":
//   • The site generated a valid RSS feed and advertised it on ZERO pages. The one <link> that
//     makes a feed discoverable — emitted by WordPress and Blogger on every page — was absent, so
//     the feed was reachable only by someone who already knew its URL.
//   • /feed answered 404. That is WordPress's own feed path, so every subscriber a migrating site
//     brings with it was pointed at nothing. Same shape as the missing sitemap: a loss with no
//     symptom, except here the thing lost is a person who chose to follow.
//   • No JSON-LD anywhere. og: tags are for sharing; JSON-LD is how a crawler decides a URL is an
//     article by an author on a date. We shipped one half of the pair.
//   • Every post declared og:type "website". The platform was telling the world a post is not one.

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedXml, feedIcon, latestBuildDate, FEED_PATH, FEED_ALIASES } from './astro/src/lib/feed.mjs';
import { ICON_PATHS, iconHrefs } from './icon-core.mjs';
import { sitePackages } from './site-packages.mjs';
import { pageGraph, jsonLdScript } from './astro/src/lib/structured-data.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'astro/src');
const layout = readFileSync(join(SRC, 'layouts/SiteLayout.astro'), 'utf8');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

const ITEMS = [
  { title: 'Second', url: 'https://x.test/devlog/b', description: 'b', date: '2026-07-14', author: 'GWEN' },
  { title: 'First', url: 'https://x.test/devlog/a', description: 'a', date: '2026-03-25', author: '' },
];

test('🔴 the feed is discoverable from every page', () => {
  assert.match(layout, /rel="alternate" type="application\/rss\+xml"/, 'the autodiscovery link exists');
  assert.match(layout, /\{hasBlog && <link rel="alternate" type="application\/rss\+xml"/,
    'gated on having a blog — a site without one must not advertise an empty feed');
  assert.match(layout, /href=\{Astro\.site \? new URL\(FEED_PATH, Astro\.site\)\.href : FEED_PATH\}/,
    'and it points at the one constant, not a second copy of the path');
});

test('🔴 the WordPress and Blogger feed paths are answered', () => {
  // 301 to the one canonical feed rather than a second copy of the document. Two reasons, and the
  // second is the one that decided it: a reader following the redirect records the new address
  // instead of subscribing twice, AND an extensionless static file (dist/feed) would be served by
  // Cloudflare Pages as application/octet-stream — Astro does not carry an endpoint's Response
  // headers into a static build. A path that answers 200 with the wrong content type is not a fix.
  assert.deepEqual(FEED_ALIASES, ['/feed', '/feeds/posts/default']);
  const redirects = readFileSync(join(HERE, 'astro/public/_redirects'), 'utf8');
  for (const alias of [...FEED_ALIASES, '/rss']) {
    const re = new RegExp('^' + alias.replace(/\//g, '\\/') + '\\s+' + FEED_PATH.replace(/[./]/g, '\\$&') + '\\s+301$', 'm');
    assert.match(redirects, re, `${alias} must 301 to ${FEED_PATH}`);
  }
  assert.match(redirects, /^\/feed\/\s+\/rss\.xml\s+301$/m, 'and the trailing-slash form, which is how WordPress links it');
});

test('🔴 no alias serves its own second copy of the feed', () => {
  // The first attempt emitted /feed as its own Astro endpoint. Two documents under two URLs is how
  // an alias drifts into being a different feed.
  for (const gone of ['pages/feed.js', 'pages/feeds/posts/default.js']) {
    assert.ok(!existsSync(join(SRC, gone)), `${gone} should be a redirect, not a duplicate document`);
  }
});

test('the channel carries what a reader needs', () => {
  const xml = feedXml({
    title: 'Devlog', link: 'https://x.test/devlog', description: 'd',
    language: 'en', selfUrl: 'https://x.test' + FEED_PATH, items: ITEMS,
    buildDate: latestBuildDate(ITEMS),
  });
  assert.match(xml, /<language>en<\/language>/);
  assert.match(xml, /<atom:link href="https:\/\/x\.test\/rss\.xml" rel="self"/, 'which URL this document IS');
  assert.match(xml, /xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom"/, 'declared, or the element is invalid');
  assert.match(xml, /<lastBuildDate>.*2026.*<\/lastBuildDate>/);
  assert.equal((xml.match(/<item>/g) || []).length, 2);
});

test('🔴 lastBuildDate comes from the CONTENT, never from a clock', () => {
  // A timestamp that moves on every build changes the bytes of a file that did not change, which
  // defeats skip-unchanged uploading — the reason the build stamp is one file and not a per-page meta.
  assert.equal(latestBuildDate(ITEMS), new Date('2026-07-14').toUTCString(), 'the newest item wins');
  assert.equal(latestBuildDate(ITEMS), latestBuildDate([...ITEMS].reverse()), 'order-independent');
  assert.equal(latestBuildDate([]), '', 'no dates → no claim');
  assert.equal(latestBuildDate([{ date: 'nonsense' }]), '', 'and an unparseable one is not a date');
});

test('optional channel fields are OMITTED, not emptied', () => {
  const xml = feedXml({ title: 't', link: 'l', description: 'd', items: [] });
  assert.doesNotMatch(xml, /<language>/);
  assert.doesNotMatch(xml, /<lastBuildDate>/);
  assert.doesNotMatch(xml, /atom:link/);
  assert.doesNotMatch(xml, /<image>/, 'no icon URL → no <image> element, not an empty one');
  assert.doesNotMatch(xml, /<webfeeds:icon>/);
});

// tile#177 — the channel <image>. A reader (Feedly, NetNewsWire, Reeder) shows the channel's
// <image> beside the feed title; without one the subscription wears a grey placeholder. The site
// already builds a PNG icon for every build (icon-core's badge, or the owner's own raster mark) —
// the feed only has to NAME it, absolutely, so a reader that fetched the document elsewhere can
// still fetch the picture.
test('🔴 tile#177: the channel carries an <image> and a webfeeds:icon, both absolute', () => {
  const xml = feedXml({
    title: 'Devlog', link: 'https://x.test/devlog', description: 'd', items: ITEMS,
    image: 'https://x.test/apple-touch-icon.png',
  });
  assert.match(xml, /<image>\s*<url>https:\/\/x\.test\/apple-touch-icon\.png<\/url>\s*<title>Devlog<\/title>\s*<link>https:\/\/x\.test\/devlog<\/link>\s*<\/image>/,
    'RSS 2.0 <image>: url, then title and link, which the spec requires to match the channel\'s own');
  assert.match(xml, /xmlns:webfeeds="http:\/\/webfeeds\.org\/rss\/1\.0"/, 'declared, or the element is invalid');
  assert.match(xml, /<webfeeds:icon>https:\/\/x\.test\/apple-touch-icon\.png<\/webfeeds:icon>/, 'Feedly reads this one');
  const channelEnd = xml.indexOf('<item>');
  assert.ok(channelEnd > 0 && xml.indexOf('<image>') < channelEnd, 'channel-level, before the first item');
  assert.equal((xml.match(/<item>/g) || []).length, 2, 'items untouched');
  const withXss = feedXml({ title: 'A & B', link: 'l', description: 'd', items: [], image: 'https://x.test/i.png?a=1&b=2' });
  assert.match(withXss, /<image>\s*<url>https:\/\/x\.test\/i\.png\?a=1&amp;b=2<\/url>\s*<title>A &amp; B<\/title>/, 'escaped like every other channel field');
});

test('🔴 tile#177: the feed icon is the PNG the site already builds — the owner\'s raster mark, else the badge', () => {
  // The same rule the layout's apple-touch-icon <link> follows (icon-core's iconHrefs), because
  // that is the one PNG every build is guaranteed to emit. Resolved against the site origin.
  const origin = 'https://x.test';
  assert.equal(feedIcon({}, origin), origin + ICON_PATHS.apple, 'no mark configured → the generated badge');
  assert.equal(feedIcon({ favicon: '/brand/mark.png' }, origin), origin + '/brand/mark.png', 'an owner\'s own PNG favicon wins');
  assert.equal(feedIcon({ favicon: 'https://cdn.x.test/mark.png' }, origin), 'https://cdn.x.test/mark.png', 'already absolute → as written');
  assert.equal(feedIcon({ favicon: '/brand/mark.svg' }, origin), origin + ICON_PATHS.apple,
    'an SVG mark is not an RSS image (the spec allows GIF/JPEG/PNG) → the badge PNG, exactly as iOS gets');
  assert.equal(feedIcon({ favicon: '/brand/mark.jpg' }, origin), origin + '/brand/mark.jpg', 'JPEG is allowed by the spec');
  assert.equal(feedIcon({ favicon: '/brand/mark.webp' }, origin), origin + ICON_PATHS.apple, 'WebP is not → the badge');
  assert.equal(feedIcon({ favicon: 'javascript:alert(1)' }, origin), origin + ICON_PATHS.apple, 'a disallowed scheme never reaches a reader');
  assert.equal(feedIcon({ favicon: '/brand/mark.png', packages: 'pwa' }, origin), origin + ICON_PATHS.apple,
    'REEF with PWA ships its own opaque set at the canonical path — the same answer the <head> gives');
  assert.equal(feedIcon({}, ''), '', 'no origin → no absolute URL → nothing claimed');
});

test('🔴 tile#177 r2: the feed icon IS the layout\'s apple-touch-icon href, resolved — or the badge when RSS cannot carry it', () => {
  // Each row names the href the layout links (iconHrefs().appleTouch — what SiteLayout renders as
  // <link rel="apple-touch-icon">) beside the feed's answer, so the pairing is asserted, not implied.
  const origin = 'https://x.test';
  // r3: `hasPwa` derived exactly as the layout derives it — from site-packages.mjs, which the
  // layout itself calls (asserted below), so a package-dependent divergence shows up in a row.
  assert.match(layout, /^const packages = sitePackages\(meta\);/m, 'the layout parses `packages:` with the shared helper');
  assert.equal((layout.match(/meta\.packages/g) || []).length, 0, 'and has no second parse of its own');
  const pair = (meta) => [iconHrefs(meta, { hasPwa: sitePackages(meta).includes('pwa') }).appleTouch.href, feedIcon(meta, origin)];
  assert.deepEqual(pair({ favicon: '/brand/mark.png', packages: 'blog pwa' }), ['/brand/mark.png', origin + '/brand/mark.png'],
    'r3: whitespace is not a package separator in the layout → PWA is off there → the owner PNG in both');
  assert.deepEqual(pair({ favicon: '/brand/mark.png', packages: 'blog, pwa' }), [ICON_PATHS.apple, origin + ICON_PATHS.apple],
    'r3: comma-separated `pwa` → the layout links the PWA badge → the feed names the same badge');
  assert.deepEqual(pair({ favicon: '//cdn.x.test/mark.png' }), ['//cdn.x.test/mark.png', 'https://cdn.x.test/mark.png'],
    'protocol-relative owner PNG: the layout links it → the feed names it, on the site\'s scheme');
  assert.deepEqual(pair({ favicon: 'brand/mark.png' }), ['brand/mark.png', 'https://x.test/brand/mark.png'],
    'relative owner PNG: the layout links it → the feed names it, resolved against the site URL');
  assert.deepEqual(pair({ favicon: 'https://x/mark.jpg' }), ['https://x/mark.jpg', 'https://x/mark.jpg'],
    'absolute owner JPEG: same URL in both');
  assert.deepEqual(pair({ favicon: '/brand/mark.webp' }), ['/brand/mark.webp', origin + ICON_PATHS.apple],
    'the layout DOES link a WebP mark as apple-touch-icon, but RSS 2.0 <image> is GIF/JPEG/PNG only → '
    + 'the feed deliberately diverges to the generated badge');
  assert.equal(feedIcon({ favicon: 'ftp://x.test/mark.png' }, origin), origin + ICON_PATHS.apple,
    'a resolved scheme other than http(s) never reaches a reader');
});

test('🔴 a post is an article, in both channels at once', () => {
  const post = readFileSync(join(SRC, 'components/PostView.astro'), 'utf8');
  assert.match(post, /'og-type': 'article'/, 'og:type — this was "website" on every post');
  assert.match(post, /'article-published-time': post\.date/);
  assert.match(layout, /article:published_time/, 'and the layout emits it');
  assert.match(layout, /ogType === 'article' \? 'article' : 'website'/, 'the SAME signal drives the JSON-LD');
});

test('JSON-LD says what is true and omits the rest', () => {
  const g = pageGraph({
    kind: 'article', url: 'https://x.test/devlog/a', siteName: 'ATLAS.DEV', siteUrl: 'https://x.test/',
    title: 'A', description: 'd', datePublished: '2026-03-25', author: 'GWEN', inLanguage: 'en',
  });
  assert.equal(g['@type'], 'BlogPosting');
  assert.equal(g.author.name, 'GWEN');
  assert.equal(g.datePublished, '2026-03-25');
  assert.ok(!('dateModified' in g), 'this platform does not track one, so it may not claim one');
  assert.ok(!('image' in g), 'no image passed → no key, not an empty string');
});

test('🔴 SearchAction is only advertised when search really exists', () => {
  const off = pageGraph({ kind: 'website', siteName: 'S', siteUrl: 'https://x.test/' });
  assert.ok(!('potentialAction' in off), 'the /search route does not exist when search is off');
  const on = pageGraph({ kind: 'website', siteName: 'S', siteUrl: 'https://x.test/', searchUrl: 'https://x.test/search' });
  assert.match(on.potentialAction.target.urlTemplate, /\/search\?q=\{search_term_string\}/);
  assert.match(layout, /searchUrl: blogSearchOn\(meta\) && hasBlog/, 'the layout proves it before passing one');
});

test('nothing true to say → no block at all', () => {
  assert.equal(pageGraph({ siteName: '', siteUrl: '' }), null);
  assert.equal(jsonLdScript(null), '');
});

test('🔴 the data island cannot end its own script element', () => {
  const s = jsonLdScript(pageGraph({ kind: 'article', siteName: 'S', siteUrl: 'https://x.test/', title: '</script><img onerror=x>' }));
  assert.ok(!s.includes('</script'), 'an unescaped < here is an injection, not a formatting nit');
  assert.match(s, /\\u003c/);
  assert.deepEqual(JSON.parse(s).headline, '</script><img onerror=x>', 'and it still round-trips as data');
});

console.log(`\n${passed} passed`);
