// tile#318: the `action=inbox` form's copy table must have a row for every locale the platform ships.
// It had five (en, ja, ko, zh-tw, zh-cn); a de, fr, es or pt-BR page resolved to the English row,
// so the form spoke English beside an inbox bubble that spoke the page's language.
//
// THE LIST IS ASKED, NOT TYPED: "the locales the platform ships" is written down once, in cardtile's
// sandbox (the same list inbox-bubble's compose test reads). A tenth locale added there fails here
// until the form has a row for it.
//   run: node --test packages/sitetile/inbox-form-locales.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { inboxFormCopy, inboxFormLocaleKey, INBOX_FORM_LOCALES } from './inbox-form-copy.js';

const { SANDBOX_LOCALES } = await import('../cardtile/w/sandbox-i18n.mjs');
const PLATFORM_TAGS = Object.values(SANDBOX_LOCALES).map((l) => l.lang);

const EN = inboxFormCopy('en');
const KEYS = Object.keys(EN);

test('the platform locale list this test reads is really there', () => {
  assert.ok(PLATFORM_TAGS.length >= 9, `only ${PLATFORM_TAGS.length} platform locales`);
  for (const tag of PLATFORM_TAGS) assert.match(String(tag), /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/);
});

test('every locale the platform ships resolves to a form row in its own language, never English', () => {
  const missing = [];
  for (const tag of PLATFORM_TAGS) {
    const key = inboxFormLocaleKey(tag);
    if (key.split('-')[0] !== tag.toLowerCase().split('-')[0]) missing.push(`${tag} → ${key}`);
  }
  assert.deepEqual(missing, [], 'platform locales with no form row of their own');
});

test('region and bare-language tags find the same row', () => {
  const cases = {
    de: 'de', 'de-AT': 'de', 'fr-CA': 'fr', 'es-MX': 'es', es: 'es',
    pt: 'pt-br', 'pt-BR': 'pt-br', 'pt-PT': 'pt-br',
    'zh-Hans': 'zh-cn', 'zh-Hant-TW': 'zh-tw', zh: 'zh-tw', 'ja-JP': 'ja', 'ko-KR': 'ko',
    'it-IT': 'en', '': 'en', 'xx-YY': 'en',
  };
  for (const [tag, row] of Object.entries(cases)) assert.equal(inboxFormLocaleKey(tag), row, JSON.stringify(tag));
});

test('every row is reached by some platform locale (no orphan rows)', () => {
  const reached = new Set(PLATFORM_TAGS.map(inboxFormLocaleKey));
  assert.deepEqual(INBOX_FORM_LOCALES.filter((k) => !reached.has(k)), []);
});

test('every row carries every key the English row carries, as a non-empty string', () => {
  for (const row of INBOX_FORM_LOCALES) {
    const c = inboxFormCopy(row);
    assert.equal(inboxFormLocaleKey(row), row, `${row} does not resolve to itself`);
    for (const k of KEYS) {
      assert.equal(typeof c[k], 'string', `${row}.${k} is not a string`);
      assert.ok(c[k].trim(), `${row}.${k} is blank`);
    }
    assert.deepEqual(Object.keys(c).sort(), [...KEYS].sort(), `${row} has keys the English row does not`);
    assert.ok(c.sentWithEmail.includes('{email}'), `${row}.sentWithEmail has no {email} placeholder`);
    assert.ok(!c.sentWithEmailGeneric.includes('{email}'), `${row}.sentWithEmailGeneric leaks {email}`);
  }
});

test('every non-English row contains no English string', () => {
  for (const row of INBOX_FORM_LOCALES) {
    if (row === 'en') continue;
    const c = inboxFormCopy(row);
    const english = KEYS.filter((k) => c[k] === EN[k]);
    assert.deepEqual(english, [], `${row} shows English for these keys`);
  }
});
