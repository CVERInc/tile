import assert from 'node:assert/strict';
import test from 'node:test';
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

