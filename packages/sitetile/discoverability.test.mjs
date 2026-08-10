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
import { feedXml, latestBuildDate, FEED_PATH, FEED_ALIASES } from './astro/src/lib/feed.mjs';
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
  { title: 'Second', url: 'https://x.test/devlog/b', description: 'b', date: '2026-07-14', author: 'GOGO' },
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
    title: 'A', description: 'd', datePublished: '2026-03-25', author: 'GOGO', inLanguage: 'en',
  });
  assert.equal(g['@type'], 'BlogPosting');
  assert.equal(g.author.name, 'GOGO');
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
