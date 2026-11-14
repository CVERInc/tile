// Every word the deck and the editor show exists in all nine locales — no silent fallback to English.
//
// deckStrings() and editStrings() fall back to English key by key, which is right at run time (an
// unlabelled control is worse than one in the wrong language) and wrong as a resting state: a key
// that is English in Korean says nothing anywhere until a Korean visitor reads it. So the rule here
// is strict, with ONE named, explicit exception list for the cells still waiting for a translator.
//
// 🔴 AWAITING_TRANSLATION is the only way a cell may be missing. It names keys, not "everything":
// a key added to either table later is not on it, so that key fails here until it carries all
// nine. And it may not go stale: a listed cell that HAS its translation fails too, so the list
// shrinks as translations land, and the change that fills the last cell deletes the constant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCALE_KEYS } from '../w/sandbox-i18n.mjs';
import { DECK_STRINGS, DECK_KEYS } from './deck-i18n.mjs';
import { EDIT3_STRINGS, EDIT3_KEYS } from './edit3-i18n.mjs';

const TABLES = {
  'deck-i18n': { keys: DECK_KEYS, own: (k) => DECK_STRINGS[k] || {} },
  'edit3-i18n': { keys: EDIT3_KEYS, own: (k) => EDIT3_STRINGS[k] || {} },
};

// The cells a translator still owes: in each entry, these keys in these locales. Nothing else.
// The translation pass filled every other cell. These 17 came back with a word the owner's banned
// list (banned-words.mjs) forbids, so they were withheld unchanged and go back to the translator.
const AWAITING_TRANSLATION = [
  { table: 'edit3-i18n', locales: ['fr'], keys: ['options', 'settingsBack', 'proposed'] },
  { table: 'edit3-i18n', locales: ['ko', 'zh-Hans'], keys: ['raw', 'openRaw', 'signInSays'] },
  { table: 'edit3-i18n', locales: ['zh-Hans', 'de', 'fr', 'es', 'pt'], keys: ['backInRaw'] },
  { table: 'edit3-i18n', locales: ['es'], keys: ['palSays', 'proposed', 'signInSays'] },
];

const awaiting = new Set();
for (const { table, locales, keys } of AWAITING_TRANSLATION) {
  for (const l of locales) for (const key of keys) awaiting.add(`${table}|${key}|${l}`);
}

const present = (v) => typeof v === 'string' && v.trim() !== '';

test('the nine locales are the sandbox’s nine', () => {
  assert.deepEqual([...LOCALE_KEYS].sort(), ['de', 'en', 'es', 'fr', 'ja', 'ko', 'pt', 'zh', 'zh-Hans'].sort());
});

test('every key exists in all nine locales, or is on AWAITING_TRANSLATION by name', () => {
  const missing = [];
  for (const [table, { keys, own }] of Object.entries(TABLES)) {
    for (const l of LOCALE_KEYS) {
      for (const key of keys) {
        if (!present(own(l)[key]) && !awaiting.has(`${table}|${key}|${l}`)) missing.push(`${table} · ${key} · ${l}`);
      }
    }
  }
  assert.deepEqual(missing, [], 'these fall back to English and are not on AWAITING_TRANSLATION');
});

test('AWAITING_TRANSLATION is not stale: every listed cell is really missing, and names a real key', () => {
  const stale = [];
  for (const cell of awaiting) {
    const [table, key, l] = cell.split('|');
    assert.ok(TABLES[table], `AWAITING_TRANSLATION names a table that does not exist: ${table}`);
    assert.ok(TABLES[table].keys.includes(key), `AWAITING_TRANSLATION names ${table} · ${key}, which English does not have`);
    assert.notEqual(l, 'en', 'English is the source, never awaiting');
    if (present(TABLES[table].own(l)[key])) stale.push(`${table} · ${key} · ${l}`);
  }
  assert.deepEqual(stale, [], 'these are translated now: take them off AWAITING_TRANSLATION');
});

test('en, zh and ja are never on the list: those three are written here', () => {
  for (const cell of awaiting) assert.ok(!/\|(en|zh|ja)$/.test(cell), cell);
});

test('every translation keeps the English placeholders, exactly', () => {
  const slots = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const wrong = [];
  for (const [table, { keys, own }] of Object.entries(TABLES)) {
    const en = own('en');
    for (const l of LOCALE_KEYS) {
      for (const key of keys) {
        const v = own(l)[key];
        if (present(v) && slots(v) !== slots(en[key])) wrong.push(`${table} · ${key} · ${l}: {${slots(v)}} ≠ {${slots(en[key])}}`);
      }
    }
  }
  assert.deepEqual(wrong, []);
});

test('control: a new key with fewer than nine locales fails, named', () => {
  const keys = [...DECK_KEYS, 'plantedNewKey'];
  const own = (l) => (l === 'en' ? { ...DECK_STRINGS.en, plantedNewKey: 'x' } : DECK_STRINGS[l] || {});
  const missing = LOCALE_KEYS.filter((l) => !present(own(l).plantedNewKey) && !awaiting.has(`deck-i18n|plantedNewKey|${l}`));
  assert.equal(keys.length, DECK_KEYS.length + 1);
  assert.deepEqual(missing.sort(), LOCALE_KEYS.filter((l) => l !== 'en').sort());
});

// Mechanical checks on every cell, in every locale (the translator's words are not judged here,
// only their shape). Banned words are words.test.mjs's job; placeholders are checked above.
const everyCell = function* () {
  for (const [table, { keys, own }] of Object.entries(TABLES)) {
    for (const l of LOCALE_KEYS) {
      if (l === 'en') continue;
      for (const key of keys) {
        const v = own(l)[key];
        if (present(v)) yield { table, key, l, v, en: own('en')[key] };
      }
    }
  }
};

test('no translation holds a line break (\\n, \\r, U+2028, U+2029)', () => {
  const breaks = String.fromCharCode(10, 13, 0x2028, 0x2029);
  const bad = [...everyCell()].filter(({ v }) => [...v].some((c) => breaks.includes(c)));
  assert.deepEqual(bad.map(({ table, key, l }) => `${table} · ${key} · ${l}`), []);
});

// The limits the translator was given, in characters (code points).
const MAX_CHARS = {
  'deck-i18n': { viewStack: 8, viewList: 8, viewWall: 8, homeCtaTitle: 20, drawCtaTitle: 15, tryNow: 15,
    fileEndTitle: 20, makeYourOwn: 20 },
  'edit3-i18n': { viewStack: 8, viewList: 8, viewWall: 8 },
};

test('view names and short labels stay within the length they were translated for', () => {
  const over = [];
  for (const { table, key, l, v } of everyCell()) {
    const max = MAX_CHARS[table][key];
    if (max && [...v].length > max) over.push(`${table} · ${key} · ${l}: “${v}” is ${[...v].length} > ${max}`);
  }
  assert.deepEqual(over, []);
});

// (zh and ja are written by hand here and may name the product their own way.)
const TRANSLATED_LOCALES = ['ko', 'zh-Hans', 'de', 'fr', 'es', 'pt'];

test('the product name “Cards” stays “Cards” wherever the English says it (translated locales)', () => {
  const lost = [...everyCell()]
    .filter(({ l, v, en }) => TRANSLATED_LOCALES.includes(l) && /\bCards\b/.test(en) && !/\bCards\b/.test(v));
  assert.deepEqual(lost.map(({ table, key, l, v }) => `${table} · ${key} · ${l}: ${v}`), []);
});

// A cell equal to its English is usually an untranslated copy. Allowed: strings of 3 characters or
// fewer (separators), and these words, which are the ordinary word in that language too.
const SAME_AS_ENGLISH = new Set([
  'edit3-i18n|text|de', 'edit3-i18n|backupL|de', 'edit3-i18n|backupL|pt', 'edit3-i18n|headerL|de',
  'edit3-i18n|iconsL|de', 'edit3-i18n|socialWeb|de',
]);

test('no translation is a copy of the English, except short strings and the named loanwords', () => {
  const same = [...everyCell()]
    .filter(({ v, en }) => v === en && [...en].length > 3)
    .map(({ table, key, l }) => `${table}|${key}|${l}`);
  assert.deepEqual(same.sort(), [...SAME_AS_ENGLISH].sort());
});
