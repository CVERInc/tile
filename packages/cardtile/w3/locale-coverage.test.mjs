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
// (zh-Hans has the deck's first eleven words already; the five added for deck.js's English it has not.)
const AWAITING_TRANSLATION = [
  {
    table: 'deck-i18n',
    locales: ['ko', 'de', 'fr', 'es', 'pt'],
    keys: ['viewStack', 'viewList', 'viewWall', 'zoomQr', 'putBack', 'homeCtaTitle', 'homeCtaText',
      'drawCtaTitle', 'drawCtaText', 'drawWhere', 'tryNow'],
  },
  {
    table: 'deck-i18n',
    locales: ['ko', 'zh-Hans', 'de', 'fr', 'es', 'pt'],
    keys: ['mdOf', 'fileEndTitle', 'fileEndText', 'makeYourOwn', 'fileNote'],
  },
  {
    table: 'edit3-i18n',
    locales: ['ko', 'zh-Hans', 'de', 'fr', 'es', 'pt'],
    keys: [
      'untitled', 'options', 'settingsBack', 'viewsAria', 'wallFrame', 'editBtn', 'raw', 'docTitle',
      'pageTitle', 'bcValue', 'dfSays', 'replaceBack', 'toBc', 'toBcDone', 'titleL', 'titleFromProfile',
      'rawSays', 'openRaw', 'bcL', 'previewFrame', 'pickHint', 'backInRaw', 'editTile', 'addBetween', 'front',
      'back', 'pairOn', 'pairOff', 'text', 'deleted', 'backdrop', 'backdropHint', 'bdNone', 'bdSet', 'bdPick',
      'bdUrl', 'bdRemove', 'dim', 'dim0', 'dim25', 'dim45', 'dim65', 'dimHint', 'auto', 'viewStack',
      'viewList', 'viewWall', 'viewSaysStack', 'viewSaysList', 'viewSaysWall', 'viewsLabel', 'opensAs',
      'full', 'width', 'savedLive', 'seek', 'palPh', 'palSays', 'palEcho', 'accentL', 'accentSays',
      'accentReset', 'accentCustom', 'themeL', 'themeAutoSays', 'themeAuto', 'themeLight', 'themeDark',
      'backupL', 'backupSays', 'download', 'replaceFile', 'replaceSays', 'replaceAsk', 'replaceGo',
      'resetAsk', 'resetSays', 'dangerSays', 'replaced', 'badFile', 'secName', 'secLook', 'secViewsBack',
      'secFound', 'secMore', 'viewsL', 'viewsKeepOne', 'listSep', 'handleL', 'handleSays', 'change',
      'newHandle', 'handleWarn', 'typeOld', 'doChange', 'handleDone', 'hShape', 'hReserved', 'handleHere',
      'domainL', 'domainSays', 'connect', 'domainNone', 'headerL', 'headerCentre', 'headerLeft', 'iconsL',
      'iconsColour', 'iconsMono', 'poolL', 'poolOn', 'poolOff', 'transferL', 'notYet', 'colon',
      'hostLoadFailed', 'reload', 'proposed', 'leaveTitle', 'leaveKeep', 'leaveDiscard', 'signIn',
      'signInSays', 'sbxStatus', 'required', 'needs', 'socialNet', 'socialLink', 'socialAdd', 'socialRemove',
      'socialWeb', 'socialEmail', 'more', 'help',
    ],
  },
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
