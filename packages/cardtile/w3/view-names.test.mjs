// The three view names are ONE set of words per locale: the deck (deck-i18n.mjs) is the source, and
// the editor (edit3-i18n.mjs) says exactly the same — its view switch and the wall's frame label
// included. A visitor who reads "Wall" on the deck and something else in the editor is told two names
// for one thing (tile#306).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCALE_KEYS } from '../w/sandbox-i18n.mjs';
import { DECK_STRINGS } from './deck-i18n.mjs';
import { EDIT3_STRINGS } from './edit3-i18n.mjs';
import { renderCardHTML } from '../serve/card-worker.mjs';
import { EDIT3_JS } from '../serve/edit3-assets.mjs';

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

// The second view is the cards SPREAD OUT side by side (the product owner's ruling, tile#306), not a
// "list". Pinned in all nine locales so a later translation run cannot quietly turn it back.
// en was still 'List' after that ruling; the owner named it 'Spread' on 2026-11-15, the word the
// other eight locales already translate (攤, Fächer, Éventail, Abanico, Leque, 펼침 …).
test('the second view is the spread, in all nine locales', () => {
  const expected = {
    en: 'Spread', zh: '攤', 'zh-Hans': '摊', ja: '並び',
    ko: '펼침', de: 'Fächer', fr: 'Éventail', es: 'Abanico', pt: 'Leque',
  };
  assert.deepEqual([...LOCALE_KEYS].sort(), Object.keys(expected).sort());
  const actual = Object.fromEntries(LOCALE_KEYS.map((l) => [l, DECK_STRINGS[l].viewList]));
  assert.deepEqual(actual, expected);
});

// The English word, end to end: the deck's table, the editor's table, the words an English visitor's
// page is sent (the switch's aria-label and title), and the editor bundle the Worker ships. Only the
// shown word changed; the key `viewList`, the mode `list` and `data-m="list"` stay as they were.
test('en: the second view is called Spread, in both tables, on a visitor page and in the shipped editor', () => {
  assert.equal(DECK_STRINGS.en.viewList, 'Spread');
  assert.equal(EDIT3_STRINGS.en.viewList, 'Spread');
  const md = ['---', 'card-page: t', 'title: T', 'lang: en', '---', '', '## grid', '', '- [ ] %% card: profile w=6 %% Bio', ''].join('\n');
  const words = JSON.parse(/window\.__deckStrings=(\{.*?\});/.exec(renderCardHTML(md))[1]);
  assert.equal(words.viewList, 'Spread');
  assert.match(EDIT3_JS, /viewList: "Spread"/);
  assert.doesNotMatch(EDIT3_JS, /viewList: "List"/);
});
