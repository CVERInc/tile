import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { inboxBubbleOn, localeAgnosticPath, pathMatches } from './astro/src/lib/inbox-bubble.mjs';

test('inbox bubble defaults on and obeys site off', () => {
  assert.equal(inboxBubbleOn({}, '/'), true);
  assert.equal(inboxBubbleOn({ 'inbox-bubble': 'off' }, '/'), false);
});

test('suffix patterns are locale agnostic', () => {
  assert.equal(localeAgnosticPath('/zh-tw/shop/item', ['en-US', 'zh-TW']), '/shop/item');
  assert.equal(pathMatches('/shop/*', '/shop/item'), true);
  assert.equal(inboxBubbleOn({ locales: 'en-US, zh-TW', 'inbox-bubble-except': '/shop/*' }, '/zh-tw/shop/item'), false);
});

test('a hand-mounted bubble is deduped', () => {
  assert.equal(inboxBubbleOn({}, '/', '<div data-dynamic-coral="inbox-bubble"></div>'), false);
});


// reef#2160: the layout tells the coral which index it may search, and only where the engine
// emits rows for it. Source-level — the astro smoke (hostile-blog build) proves the built page.
test('reef#2160: the mount carries data-search-index only for a blog site with bubble search on', () => {
  const layout = readFileSync(new URL('./astro/src/layouts/SiteLayout.astro', import.meta.url), 'utf8');
  assert.match(layout, /const hasBlogPosts = Object\.keys\(import\.meta\.glob\('\.\.\/\.\.\/blog\/\*\.md'\)\)\.length > 0;/, 'the posts arm of blogInstalled, lazily');
  assert.match(layout, /const bubbleSearch = \(hasBlog \|\| hasBlogPosts\) && bubbleSearchOn\(meta\);/, 'declared OR holding posts, same switch as the index');
  assert.match(layout, /data-search-index=\{bubbleSearch \? '\/search-index\.json' : undefined\}/, 'absent (not empty) when off, so the DOM is unchanged');
});
