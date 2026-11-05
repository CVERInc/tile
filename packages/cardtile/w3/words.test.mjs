// Ruler #3: no engineering words on the editor surface, nine locales, every catalogue it uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SANDBOX_LOCALES, CHROME_STRINGS, LOCALE_KEYS } from '../w/sandbox-i18n.mjs';
import { cellStrings } from '../w/cell-i18n.mjs';
import { EDIT3_STRINGS } from './edit3-i18n.mjs';
import { DECK_STRINGS } from './deck-i18n.mjs';
import { BANNED, scanBanned } from './banned-words.mjs';

const byLocale = (fn) => Object.fromEntries(LOCALE_KEYS.map((k) => [k, fn(k)]));
// `lang` is a BCP-47 tag, not copy; the persona fields are what the banner and starter card print.
const persona = (k) => { const { lang, ...rest } = SANDBOX_LOCALES[k]; return rest; };
const TABLES = () => ({
  'sandbox-i18n SANDBOX_LOCALES': byLocale(persona),
  'sandbox-i18n CHROME_STRINGS': byLocale((k) => CHROME_STRINGS[k]),
  // each locale's OWN strings: a key that falls back to English is English, and English is scanned as en
  'edit3-i18n': byLocale((k) => EDIT3_STRINGS[k]),
  'deck-i18n': byLocale((k) => ({ ...DECK_STRINGS.en, ...(DECK_STRINGS[k] || {}) })),
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

// 🔴 ONE NAMED EXCEPTION. The editor calls the file itself "Raw content" (and the same in zh-TW): the sheet that edits a
// tile or the whole card as written, the picker's last choice, and the Cards settings row that opens it.
// en "raw" and its zh-TW word are on the banned list for the sentences around a form; here they are the name of the
// one place the file is shown as it is. Exactly these keys, exactly that word — anything else still fails.
const RAW_CONTENT_KEYS = new Set(['raw', 'openRaw', 'backInRaw', 'free', 'toFree']);
const isRawContentName = (h) => h.catalogue === 'edit3-i18n' && RAW_CONTENT_KEYS.has(h.key)
  && ((h.locale === 'en' && h.word === String(/\braw\b/i)) || (h.locale === 'zh' && h.word === String(/原始/)));

test('no engineering word in any editor string, any locale', () => {
  const hits = scanBanned(TABLES()).filter((h) => !isRawContentName(h));
  assert.deepEqual(hits.map((h) => `${h.catalogue} · ${h.key} · ${h.locale}: ${h.word} in “${h.text}”`), []);
});

test('control: a planted banned word is caught, named by key and locale', () => {
  const planted = TABLES();
  for (const [locale, word] of [['en', 'Open the sandbox'], ['zh', '看預覽'], ['de', 'Rohe Parameter'], ['ja', 'プレビュー']]) {
    planted['edit3-i18n'][locale] = { ...planted['edit3-i18n'][locale], 'plant.x': word };
  }
  const hits = scanBanned(planted).filter((h) => h.key === 'plant.x');
  assert.deepEqual([...new Set(hits.map((h) => h.locale))].sort(), ['de', 'en', 'ja', 'zh']);
  assert.ok(hits.every((h) => h.catalogue === 'edit3-i18n'));
  // and the named exception is no wider than its name: the same word under another key is still caught
  const wide = scanBanned({ 'edit3-i18n': { en: { pal: 'Raw output' } } });
  assert.equal(wide.filter((h) => !isRawContentName(h)).length, 1);
  // and the boundary: "drawer" is not "raw"
  assert.deepEqual(scanBanned({ t: { en: { k: 'Add a drawer' } } }), []);
});
