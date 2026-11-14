// The words the deck (w3/deck.js) puts in front of a VISITOR, in the card's own language — the
// card's `lang:` frontmatter, the same choice the renderer's own strings follow. Not the editor's
// words (those are w3/edit3-i18n.mjs) and not the renderer's (card-render.mjs `LABELS`).
//
// Keyed by the sandbox's nine locale keys (w/sandbox-i18n.mjs LOCALE_KEYS). A locale without its own
// entry for a key falls back to English, key by key; DECK_MISSING lists exactly which ones do.
// en, zh (Traditional) and ja are written here in full; w3/locale-coverage.test.mjs fails on any
// other missing cell that its AWAITING_TRANSLATION list does not name.
import { LOCALE_KEYS, primaryLocale } from '../w/sandbox-i18n.mjs';

// the words written here by hand: en, zh, ja, and zh-Hans's first eleven
const WRITTEN = {
  en: {
    viewStack: 'Stack',
    viewList: 'List',
    viewWall: 'Wall',
    zoomQr: 'Enlarge the QR code',
    putBack: 'Put back',
    // reef.cards' own pages (data-reef-home / data-reef-draw): the last card's words
    homeCtaTitle: 'Your turn.',
    homeCtaText: 'No sign-up. Start changing it now.',
    drawCtaTitle: 'Next',
    drawCtaText: 'Tap for someone else.',
    drawWhere: 'Other people’s Cards, picked at random',
    tryNow: 'Try it now',
    // ↓ words deck.js still hard-codes in English; deck.js does not say() them yet — see
    //   DECK_AWAITING_DECK_JS below for the exact call sites. `{i}`/`{n}` are numbers deck.js fills in.
    mdOf: '{i} of {n}',
    fileEndTitle: 'That’s all.',
    fileEndText: '{n} in one file.',
    makeYourOwn: 'Make your own',
    fileNote: 'One file. Under 25 MB.',
  },
  zh: {
    viewStack: '疊',
    viewList: '攤',
    viewWall: '牆',
    zoomQr: '放大 QR',
    putBack: '放回去',
    homeCtaTitle: '換你了。',
    homeCtaText: '不用註冊，現在就動手改。',
    drawCtaTitle: '下一位',
    drawCtaText: '點一下，換一個人。',
    drawWhere: '其他人的 Cards，隨機挑的',
    tryNow: '立刻試做',
    mdOf: '第 {i} 張，共 {n} 張',
    fileEndTitle: '就這些。',
    fileEndText: '一個檔案，{n} 張。',
    makeYourOwn: '做一份自己的',
    fileNote: '一個檔案，不到 25 MB。',
  },
  // 重ね / 縦並び / 一覧: native words, not katakana loans. 重ね (cards laid on one another) and 縦並び
  // (lined up top to bottom, the list view's own movement) say what each view does; 一覧 is the word
  // Japanese interfaces already use for "everything at once". ウォール does not read as a view in
  // Japanese, and タイル is taken: it is the unit word in every Japanese table here.
  ja: {
    viewStack: '重ね',
    viewList: '縦並び',
    viewWall: '一覧',
    zoomQr: 'QR コードを拡大',
    putBack: 'カードを戻す',
    homeCtaTitle: '次はあなたの番。',
    homeCtaText: '登録はいりません。今すぐ変えてみてください。',
    drawCtaTitle: '次へ',
    drawCtaText: 'タップすると、別の人に。',
    drawWhere: 'ほかの人の Cards から、ランダムに',
    tryNow: '今すぐ試す',
    mdOf: '{n} 枚中 {i} 枚目',
    fileEndTitle: 'これで全部です。',
    fileEndText: '1 つのファイルに {n} 枚。',
    makeYourOwn: '自分のを作る',
    fileNote: 'ファイルは 1 つ、25 MB 未満。',
  },
  // the same words as zh, in Simplified characters
  'zh-Hans': {
    viewStack: '叠',
    viewList: '摊',
    viewWall: '墙',
    zoomQr: '放大 QR',
    putBack: '放回去',
    homeCtaTitle: '换你了。',
    homeCtaText: '不用注册，现在就动手改。',
    drawCtaTitle: '下一位',
    drawCtaText: '点一下，换一个人。',
    drawWhere: '其他人的 Cards，随机挑的',
    tryNow: '立刻试做',
  },
};

// The words a translator supplied, one object per locale, keys in English's order. Strict JSON between
// the two marker lines, so the translation step can read the block and rewrite it whole; a key here
// never replaces one in WRITTEN (the merge below lets WRITTEN win), so hand-written words stay.
// <translated>
const TRANSLATED = {};
// </translated>

export const DECK_STRINGS = Object.fromEntries(LOCALE_KEYS
  .filter((k) => WRITTEN[k] || TRANSLATED[k])
  .map((k) => [k, { ...(TRANSLATED[k] || {}), ...(WRITTEN[k] || {}) }]));

export const DECK_KEYS = Object.keys(DECK_STRINGS.en);

// 🔴 Keys the table carries BEFORE deck.js says them (tile#298 part 2). deck.js still writes these words
// in English at the lines named here; it is being restructured elsewhere, and the switch to say()
// lands with that. gen-edit3-assets.mjs normally refuses a key deck.js never says; it lets exactly
// these through, and refuses them again the moment deck.js does say one — so this list is deleted
// by the change that makes deck.js use them, not left to rot.
export const DECK_AWAITING_DECK_JS = {
  mdOf: "deck.js:136 the plain md-text back: (i-P+1)+' of '+M",
  fileEndTitle: "deck.js:192 the capacity demo's last card: <h2>That's all.</h2>",
  fileEndText: "deck.js:192 the same card: (window.__mdCount).toLocaleString('en-US')+' in one file.'",
  makeYourOwn: "deck.js:195 goBack(…, 'Make your own', …)",
  fileNote: "deck.js:195 goBack(…, 'One file. Under 25 MB.')",
};

/** every (locale, key) that falls back to English — the list a translator works from */
export const DECK_MISSING = Object.fromEntries(LOCALE_KEYS.filter((k) => k !== 'en')
  .map((k) => [k, DECK_KEYS.filter((key) => !(DECK_STRINGS[k] && key in DECK_STRINGS[k]))])
  .filter(([, keys]) => keys.length));

/** the deck's words for a BCP-47 tag (a card's `lang:`) or a locale key, English for anything missing */
export function deckStrings(tagOrKey) {
  const k = primaryLocale(tagOrKey || 'en');
  return { ...DECK_STRINGS.en, ...(DECK_STRINGS[k] || {}) };
}
