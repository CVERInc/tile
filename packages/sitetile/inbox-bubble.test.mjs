import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { inboxBubbleOn, localeAgnosticPath, pathMatches } from './astro/src/lib/inbox-bubble.mjs';
import * as bubble from './astro/src/lib/inbox-bubble.mjs';

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

// `inbox-bubble-color: accent` (opt-in): the bubble follows the site theme's accent. The coral already
// reads `--reef-inbox-accent` / `--reef-inbox-on-accent` from its container, so the only change is an
// inline style on the mount. Without the key, or with any other value, the mount carries NO style
// attribute, so every existing site's markup is byte-identical.
const ACCENT_STYLE = '--reef-inbox-accent:var(--gd-accent);--reef-inbox-on-accent:var(--gd-accent-ink,#fff)';

test('inbox-bubble-color: accent sets both bubble variables from the theme tokens', () => {
  assert.equal(typeof bubble.inboxBubbleStyle, 'function', 'inbox-bubble.mjs exports inboxBubbleStyle');
  assert.equal(bubble.inboxBubbleStyle({ 'inbox-bubble-color': 'accent' }), ACCENT_STYLE);
  assert.equal(bubble.inboxBubbleStyle({ 'inbox-bubble-color': '  Accent ' }), ACCENT_STYLE, 'trimmed, case-insensitive');
  assert.equal(bubble.inboxBubbleStyle({ 'inbox-bubble-color': 'ACCENT' }), ACCENT_STYLE);
});

test('inbox-bubble-color: no key, default, empty or an unknown value set nothing', () => {
  assert.equal(typeof bubble.inboxBubbleStyle, 'function', 'inbox-bubble.mjs exports inboxBubbleStyle');
  for (const meta of [
    {}, undefined,
    { 'inbox-bubble-color': 'default' }, { 'inbox-bubble-color': 'Default' },
    { 'inbox-bubble-color': '' }, { 'inbox-bubble-color': '   ' },
    { 'inbox-bubble-color': 'accent2' }, { 'inbox-bubble-color': 'accents' }, { 'inbox-bubble-color': 'theme' },
    { 'inbox-bubble-color': '#1f6feb' }, { 'inbox-bubble-color': 'on' },
    // a near-miss key is not the key
    { 'inbox-bubble-colour': 'accent' }, { 'inbox-bubble': 'accent' },
  ]) {
    assert.equal(bubble.inboxBubbleStyle(meta), undefined, `nothing for ${JSON.stringify(meta)}`);
  }
});

// Source-level, like the search-index check above: the style rides on the bubble mount only, as an
// expression that can be `undefined`, so Astro omits the attribute (not `style=""`) when the key is
// absent. The astro smoke's exact-markup regexes hold the no-key mount byte-identical on a built page.
test('inbox-bubble-color: the layout puts the style on the bubble mount, and only there', () => {
  const layout = readFileSync(new URL('./astro/src/layouts/SiteLayout.astro', import.meta.url), 'utf8');
  assert.match(layout, /import \{[^}]*\binboxBubbleStyle\b[^}]*\} from '\.\.\/lib\/inbox-bubble\.mjs';/, 'imported from the one module');
  assert.match(layout, /<div data-dynamic-coral="inbox-bubble" [^>]*\bstyle=\{inboxBubbleStyle\(meta\)\}[^>]*><\/div>/, 'on the mount div');
  assert.equal(layout.split('inboxBubbleStyle(').length - 1, 1, 'called exactly once');
});
