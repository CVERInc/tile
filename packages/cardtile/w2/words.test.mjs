// Ruler #3: no engineering words on the editor surface, nine locales, every catalogue it uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SANDBOX_LOCALES, CHROME_STRINGS, LOCALE_KEYS } from '../w/sandbox-i18n.mjs';
import { cellStrings } from '../w/cell-i18n.mjs';
import { boardStrings } from './board-i18n.mjs';
import { BANNED, scanBanned } from './banned-words.mjs';

const byLocale = (fn) => Object.fromEntries(LOCALE_KEYS.map((k) => [k, fn(k)]));
// `lang` is a BCP-47 tag, not copy; the persona fields are what the banner and starter card print.
const persona = (k) => { const { lang, ...rest } = SANDBOX_LOCALES[k]; return rest; };
const TABLES = () => ({
  'sandbox-i18n SANDBOX_LOCALES': byLocale(persona),
  'sandbox-i18n CHROME_STRINGS': byLocale((k) => CHROME_STRINGS[k]),
  'board-i18n': byLocale(boardStrings),
  'cell-i18n': byLocale(cellStrings),
});

test('there is a banned list for each of the nine locales', () => {
  assert.equal(LOCALE_KEYS.length, 9);
  for (const k of LOCALE_KEYS) assert.ok(BANNED[k]?.length, `no banned list for ${k}`);
});

test('every catalogue has a table for every locale (the scan sees all nine)', () => {
  for (const [name, t] of Object.entries(TABLES())) {
    for (const k of LOCALE_KEYS) assert.ok(t[k] && Object.keys(t[k]).length > 0, `${name} has nothing for ${k}`);
  }
});

test('no engineering word in any editor string, any locale', () => {
  const hits = scanBanned(TABLES());
  assert.deepEqual(hits.map((h) => `${h.catalogue} · ${h.key} · ${h.locale}: ${h.word} in “${h.text}”`), []);
});

test('control: a planted banned word is caught, named by key and locale', () => {
  const planted = TABLES();
  for (const [locale, word] of [['en', 'Open the sandbox'], ['zh', '看預覽'], ['de', 'Rohe Parameter'], ['ja', 'プレビュー']]) {
    planted['board-i18n'][locale] = { ...planted['board-i18n'][locale], 'plant.x': word };
  }
  const hits = scanBanned(planted).filter((h) => h.key === 'plant.x');
  assert.deepEqual([...new Set(hits.map((h) => h.locale))].sort(), ['de', 'en', 'ja', 'zh']);
  assert.ok(hits.every((h) => h.catalogue === 'board-i18n'));
  // and the boundary: "drawer" is not "raw"
  assert.deepEqual(scanBanned({ t: { en: { k: 'Add a drawer' } } }), []);
});
