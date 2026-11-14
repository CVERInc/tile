// The three view names are ONE set of words per locale: the deck (deck-i18n.mjs) is the source, and
// the editor (edit3-i18n.mjs) says exactly the same — its view switch and the wall's frame label
// included. A visitor who reads "Wall" on the deck and something else in the editor is told two names
// for one thing (tile#306).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCALE_KEYS } from '../w/sandbox-i18n.mjs';
import { DECK_STRINGS } from './deck-i18n.mjs';
import { EDIT3_STRINGS } from './edit3-i18n.mjs';

const PAIRS = [['viewStack', 'viewStack'], ['viewList', 'viewList'], ['viewWall', 'viewWall'], ['wallFrame', 'viewWall']];

test('the editor names the three views with the deck’s words, in all nine locales', () => {
  const unequal = [];
  for (const l of LOCALE_KEYS) {
    const deck = DECK_STRINGS[l] || {};
    const edit = EDIT3_STRINGS[l] || {};
    for (const [editKey, deckKey] of PAIRS) {
      if (edit[editKey] !== deck[deckKey]) unequal.push(`${l} · editor ${editKey} “${edit[editKey]}” ≠ deck ${deckKey} “${deck[deckKey]}”`);
    }
  }
  assert.deepEqual(unequal, []);
});

test('ja: the list view is 並び in both tables', () => {
  assert.equal(DECK_STRINGS.ja.viewList, '並び');
  assert.equal(EDIT3_STRINGS.ja.viewList, '並び');
});
