// The `form` coral's `action=inbox` post-submit copy (owner ruling, 2026-09-03: "the standard
// pattern" — a submitting state, a success CARD, and an inline retry error, replacing a same-size
// paragraph under a form that STAYS). Form.astro's own rendering is covered end-to-end by
// smoke-build.mjs (the ONE fixture locale, en-US, since forms.md declares `lang: en-US`); this file
// is the locale TABLE's own unit coverage — every key, every one of the five rows
// (ja/zh-tw/zh-cn/ko/en) inboxFormLocaleKey can resolve to, and the tag-matching rules that route a
// site's raw `lang:` frontmatter to one of them. A locale missing here breaks silently: a Korean
// contact form falling back to `undefined.submitting` renders "undefined" as the button's own
// label, and nothing in the build catches it — this table is exactly where that should be caught.
//   run: node packages/sitetile/inbox-form-copy.test.mjs

import assert from 'node:assert/strict';
import { inboxFormCopy } from './astro/src/packages/lingo/locale.mjs';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

// One row per script inboxFormLocaleKey can resolve to (ja / zh-tw / zh-cn / ko / en) — a `lang:`
// each row actually resolves FROM, exercised in the "routes every lang a site could write" test
// below rather than assumed here.
const KEYS = [
  'fieldRequired', 'sentWithEmail', 'sentWithEmailGeneric', 'sentNoEmail',
  'submitting', 'successHeading', 'backHome', 'errorNetwork', 'errorServer',
];
const LANGS = { ja: 'ja-JP', 'zh-tw': 'zh-TW', 'zh-cn': 'zh-CN', ko: 'ko-KR', en: 'en-US' };

test('every row has the full set of post-submit keys, all non-empty strings', () => {
  for (const [key, lang] of Object.entries(LANGS)) {
    const c = inboxFormCopy(lang);
    for (const k of KEYS) {
      assert.equal(typeof c[k], 'string', `${key} (${lang}) .${k} is not a string`);
      assert.ok(c[k].trim(), `${key} (${lang}) .${k} is blank`);
    }
  }
});

// Owner ruling's exact four (2026-09-03): 「送出中…」/ ja / zh-TW / en / zh-CN. ko is a fifth row
// this table already carried (required-field message, sent line) — left in rather than broken, but
// not one of the four the ruling named, so it is not re-asserted verbatim here.
test('🔴 submitting text matches the owner ruling verbatim, per named locale', () => {
  assert.equal(inboxFormCopy('zh-TW').submitting, '送出中…');
  assert.equal(inboxFormCopy('zh-CN').submitting, '发送中…');
  assert.equal(inboxFormCopy('ja-JP').submitting, '送信中…');
  assert.equal(inboxFormCopy('en-US').submitting, 'Sending…');
});

test('🔴 no locale borrows another\'s script for the new strings (Simplified vs Traditional, in particular)', () => {
  const tw = inboxFormCopy('zh-TW');
  const cn = inboxFormCopy('zh-CN');
  for (const k of ['submitting', 'successHeading', 'backHome']) {
    assert.notEqual(tw[k], cn[k], `zh-TW and zh-CN share the same ${k} — the whole reason this is its own table`);
  }
  // Traditional-only characters a Simplified reader would not be handed, and vice versa.
  assert.ok(tw.backHome.includes('頁'), 'zh-TW backHome should use 頁, not 页');
  assert.ok(cn.backHome.includes('页'), 'zh-CN backHome should use 页, not 頁');
});

test('sentWithEmail carries the literal {email} placeholder every locale\'s script fills in', () => {
  for (const lang of Object.values(LANGS)) {
    assert.ok(inboxFormCopy(lang).sentWithEmail.includes('{email}'), `${lang} sentWithEmail has no {email} placeholder`);
  }
});

test('sentWithEmailGeneric never leaks the {email} placeholder — it is the build-time, no-address fallback', () => {
  for (const lang of Object.values(LANGS)) {
    assert.ok(!inboxFormCopy(lang).sentWithEmailGeneric.includes('{email}'), `${lang} sentWithEmailGeneric leaks {email}`);
  }
});

test('errorNetwork and errorServer are two different sentences, in every locale', () => {
  for (const lang of Object.values(LANGS)) {
    const c = inboxFormCopy(lang);
    assert.notEqual(c.errorNetwork, c.errorServer, `${lang} uses the same text for both — the whole point of the split`);
  }
});

test('🔴 routes every lang a site could plausibly write, including Simplified vs Traditional Chinese', () => {
  const same = (a, b) => assert.deepEqual(inboxFormCopy(a), inboxFormCopy(b), `${a} vs ${b}`);
  same('ja', 'ja-JP');
  same('ko', 'ko-KR');
  same('zh-TW', 'zh-Hant');
  same('zh-Hant-TW', 'zh-tw');
  same('zh-Hans', 'zh-CN');
  same('zh-Hans-SG', 'zh-SG');
  assert.notDeepEqual(inboxFormCopy('zh-Hans'), inboxFormCopy('zh-Hant'), 'the two scripts must not collapse to one row');
  same('fr-FR', 'en-US'); // an unmapped language still gets a full row, never a hole
  same('', 'en-US');
});
