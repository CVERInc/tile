// Guard: the inbox bubble's ask-the-assistant half (`data-kaito="1"`) follows whether the site HAS the
// assistant, not whether its config happens to name a corpus scope.
//   run: node --test packages/sitetile/bubble-kaito.test.mjs   (globbed into scripts/test.sh)
//
// WHY. `kaito-corpus` only says WHAT the assistant answers from (`pages` | `all`), and when the line
// is absent the indexing side reads it as `pages`. The renderer used to read the same absence as
// "no assistant", so a site that had the assistant but never wrote the line shipped a bubble with no
// way to ask it. The build host now passes the entitlement as SITE_KAITO:
//
//   SITE_KAITO=1  ⇒ the site has it   ⇒ AI half on, whatever the config says about scope
//   SITE_KAITO=0  ⇒ the site lacks it ⇒ AI half off, EVEN IF the config names a scope (reverse guard)
//   unset / other ⇒ nobody said        ⇒ the pre-entitlement reading of the config, unchanged
//
// The third row is what a self-hosted build and an older build host get, so it must stay exactly
// what it was. Doubles are deliberately uneven: different scopes, `packages` lists with the module in
// the middle and at the end, env values that LOOK like yes but are not the one token.

import assert from 'node:assert/strict';
import test from 'node:test';
import { bubbleKaitoOn } from './astro/src/lib/bubble-kaito.mjs';

const HAS = { SITE_KAITO: '1' };
const LACKS = { SITE_KAITO: '0' };

test('has it + config names no scope ⇒ AI half on', () => {
  assert.equal(bubbleKaitoOn({}, HAS), true);
  assert.equal(bubbleKaitoOn({ 'site-title': 'Harbour Press', packages: 'blog, pwa' }, HAS), true);
});

test('lacks it + config names a scope ⇒ AI half OFF (reverse-direction guard)', () => {
  assert.equal(bubbleKaitoOn({ 'kaito-corpus': 'all' }, LACKS), false);
  assert.equal(bubbleKaitoOn({ 'kaito-corpus': 'pages' }, LACKS), false);
  assert.equal(bubbleKaitoOn({ packages: 'blog, kaito, lingo' }, LACKS), false);
  assert.equal(bubbleKaitoOn({ 'kaito-corpus': 'all', packages: 'kaito' }, LACKS), false);
});

test('has it + config names a scope ⇒ AI half on (the scope itself is the indexer\'s business)', () => {
  assert.equal(bubbleKaitoOn({ 'kaito-corpus': 'all' }, HAS), true);
  assert.equal(bubbleKaitoOn({ 'kaito-corpus': 'pages', packages: 'lingo' }, HAS), true);
});

test('lacks it + config names nothing ⇒ AI half off', () => {
  assert.equal(bubbleKaitoOn({}, LACKS), false);
  assert.equal(bubbleKaitoOn({ packages: 'blog' }, LACKS), false);
});

test('nobody said (unset) ⇒ the pre-entitlement reading of the config, byte for byte', () => {
  assert.equal(bubbleKaitoOn({}, {}), false);
  assert.equal(bubbleKaitoOn({ 'kaito-corpus': 'pages' }, {}), true);
  assert.equal(bubbleKaitoOn({ packages: 'blog, kaito' }, {}), true);
  assert.equal(bubbleKaitoOn({ packages: 'kaitoish' }, {}), false);
  assert.equal(bubbleKaitoOn({ 'kaito-corpus': '' }, {}), true, 'an empty line was "set" before and stays so');
});

test('only the exact tokens are answers; anything else is "nobody said"', () => {
  for (const v of ['true', 'yes', ' 1', '01', 'on', '']) {
    assert.equal(bubbleKaitoOn({}, { SITE_KAITO: v }), false, `SITE_KAITO=${JSON.stringify(v)} with no config`);
    assert.equal(bubbleKaitoOn({ 'kaito-corpus': 'all' }, { SITE_KAITO: v }), true, `SITE_KAITO=${JSON.stringify(v)} with a scope`);
  }
});

test('the default env argument is the real process env, not an empty object', () => {
  const before = process.env.SITE_KAITO;
  try {
    process.env.SITE_KAITO = '1';
    assert.equal(bubbleKaitoOn({}), true);
    process.env.SITE_KAITO = '0';
    assert.equal(bubbleKaitoOn({ 'kaito-corpus': 'all' }), false);
  } finally {
    if (before === undefined) delete process.env.SITE_KAITO; else process.env.SITE_KAITO = before;
  }
});
