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
  'submitting', 'successHeading', 'backHome', 'errorNetwork', 'errorServer', 'errorNotClaimed', 'errorInboxStorageFull', 'sendAnother',
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

test('success panel describes the reply address without assuming a shop or a role', () => {
  const expected = {
    ja: [
      'メッセージを受け付けました。返信は {email} に届きます。',
      'メッセージを受け付けました。返信はご入力のメールアドレスに届きます。',
      '返信をご希望の場合はメールアドレスをご記入ください。',
    ],
    'zh-tw': [
      '訊息已收到。回覆會寄到 {email}。',
      '訊息已收到。回覆會寄到你填的信箱。',
      '如需回覆，請留下 email。',
    ],
    'zh-cn': [
      '消息已收到。回复会发送到 {email}。',
      '消息已收到。回复会发送到你填写的邮箱。',
      '如需回复，请留下 email。',
    ],
    ko: [
      '메시지를 받았습니다. 답변은 {email}(으)로 전달됩니다.',
      '메시지를 받았습니다. 답변은 입력하신 메일 주소로 전달됩니다.',
      '답변을 받고 싶다면 이메일을 남겨 주세요.',
    ],
    en: [
      "Your message was received. The reply will go to {email}.",
      "Your message was received. The reply will go to the address you entered.",
      "Leave an email if you'd like a reply.",
    ],
  };
  for (const [key, lang] of Object.entries(LANGS)) {
    const copy = inboxFormCopy(lang);
    assert.deepEqual(
      [copy.sentWithEmail, copy.sentWithEmailGeneric, copy.sentNoEmail],
      expected[key],
      `${key} success panel copy`,
    );
  }
});

test('sentWithEmail and sentWithEmailGeneric never claim a confirmation mail was sent, in every locale', () => {
  // A submit whose visitor ack was refused by the per-address ceiling still gets this sentence.
  const claim = /confirmation|確認信|确认信|確認メール|확인 메일/i;
  for (const lang of Object.values(LANGS)) {
    const c = inboxFormCopy(lang);
    assert.ok(!claim.test(c.sentWithEmail), `${lang} sentWithEmail claims a confirmation mail`);
    assert.ok(!claim.test(c.sentWithEmailGeneric), `${lang} sentWithEmailGeneric claims a confirmation mail`);
  }
});

test('errorNetwork and errorServer are two different sentences, in every locale', () => {
  for (const lang of Object.values(LANGS)) {
    const c = inboxFormCopy(lang);
    assert.notEqual(c.errorNetwork, c.errorServer, `${lang} uses the same text for both — the whole point of the split`);
  }
});

// reef#2204: a site whose owner never claimed Inbox answers every submit with `not_claimed` —
// permanently, until the owner presses one button. `errorServer` ("please try again") told the
// visitor to retry something that cannot work; tniop's agent spent a session hunting the "bug".
// The sentence for that outcome states the fact and promises nothing, in every locale.
test('🔴 reef#2204 errorNotClaimed: owner-named sentences verbatim, and never a "try again"', () => {
  assert.equal(inboxFormCopy('zh-TW').errorNotClaimed, '這個網站目前沒有開放留言。');
  assert.equal(inboxFormCopy('en-US').errorNotClaimed, "This site isn't taking messages right now.");
  const retryWords = { ja: /もう一度|再試行/, 'zh-tw': /再試|重試/, 'zh-cn': /再试|重试/, ko: /다시/, en: /try again|retry/i };
  for (const [key, lang] of Object.entries(LANGS)) {
    const c = inboxFormCopy(lang);
    assert.notEqual(c.errorNotClaimed, c.errorServer, `${key} (${lang}) errorNotClaimed is just errorServer again`);
    assert.notEqual(c.errorNotClaimed, c.errorNetwork, `${key} (${lang}) errorNotClaimed is just errorNetwork again`);
    assert.doesNotMatch(c.errorNotClaimed, retryWords[key], `${key} (${lang}) errorNotClaimed asks the visitor to retry — the one thing it must not say`);
  }
  assert.notEqual(inboxFormCopy('zh-TW').errorNotClaimed, inboxFormCopy('zh-CN').errorNotClaimed, 'zh-TW and zh-CN share the same errorNotClaimed');
});

// bug #2 (2026-09-04): the success card had no way back to the form — reload, the back button, or
// sharing the URL all kept showing 「送信しました」 forever, and the JS-handled submit left the
// card up with no escape either. `sendAnother` is the card's own way out.
test('🔴 sendAnother exists, is non-empty, and is not just backHome relabelled, in every locale', () => {
  for (const [key, lang] of Object.entries(LANGS)) {
    const c = inboxFormCopy(lang);
    assert.equal(typeof c.sendAnother, 'string', `${key} (${lang}) sendAnother is not a string`);
    assert.ok(c.sendAnother.trim(), `${key} (${lang}) sendAnother is blank`);
    assert.notEqual(c.sendAnother, c.backHome, `${key} (${lang}) sendAnother is identical to backHome — two different destinations need two different labels`);
  }
});

test('sendAnother does not borrow another script (Simplified vs Traditional, in particular)', () => {
  const tw = inboxFormCopy('zh-TW');
  const cn = inboxFormCopy('zh-CN');
  assert.notEqual(tw.sendAnother, cn.sendAnother, 'zh-TW and zh-CN share the same sendAnother');
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


test('reef#2357 full inbox copy is distinct and never asks for a retry in any locale', () => {
  assert.equal(inboxFormCopy('en-US').errorInboxStorageFull, "This site's inbox is full and can't take new messages right now.");
  const fullState = {
    'zh-TW': '這個網站的收件匣已滿，目前無法接收新訊息。',
    'zh-CN': '这个网站的收件箱已满，目前无法接收新消息。',
    'ja-JP': 'このサイトの受信箱はいっぱいで、現在新しいメッセージを受け取れません。',
    'ko-KR': '이 사이트의 받은편지함이 가득 차서 현재 새 메시지를 받을 수 없습니다.',
  };
  for (const [lang, expected] of Object.entries(fullState)) assert.equal(inboxFormCopy(lang).errorInboxStorageFull, expected);
  const retryWords = { ja: /もう一度|再試行/, 'zh-tw': /再試|重試/, 'zh-cn': /再试|重试/, ko: /다시/, en: /try again|retry/i };
  for (const [key, lang] of Object.entries(LANGS)) {
    const c = inboxFormCopy(lang);
    assert.notEqual(c.errorInboxStorageFull, c.errorServer);
    assert.notEqual(c.errorInboxStorageFull, c.errorNotClaimed);
    assert.doesNotMatch(c.errorInboxStorageFull, retryWords[key]);
  }
});

console.log('inbox-form-copy: ' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : ', all green'));
