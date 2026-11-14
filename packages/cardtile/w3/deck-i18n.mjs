// The words the deck (w3/deck.js) puts in front of a VISITOR, in the card's own language — the
// card's `lang:` frontmatter, the same choice the renderer's own strings follow. Not the editor's
// words (those are w3/edit3-i18n.mjs) and not the renderer's (card-render.mjs `LABELS`).
//
// Keyed by the sandbox's nine locale keys (w/sandbox-i18n.mjs LOCALE_KEYS). A locale without its own
// entry for a key falls back to English, key by key; DECK_MISSING lists exactly which ones do.
// en, zh (Traditional) and ja are written here in full; w3/locale-coverage.test.mjs fails on any
// missing cell in any locale.
//
// 🔴 viewStack / viewList / viewWall are also the EDITOR's view names, in every locale: edit3-i18n.mjs
// takes them from here and writes none of its own (tile#306; w3/view-names.test.mjs).
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
  // 重ね / 並び / 一覧: native words, not katakana loans. 重ね (cards laid on one another) and 並び
  // (cards set out side by side, in a row) say what each view does — nothing about the list view is
  // vertical, so not 縦並び; 一覧 is the word Japanese interfaces already use for "everything at once".
  // ウォール does not read as a view in Japanese, and タイル is taken: it is the unit word in every
  // Japanese table here.
  ja: {
    viewStack: '重ね',
    viewList: '並び',
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
const TRANSLATED = {
  "ko": {
    "viewStack": "스택",
    "viewList": "목록",
    "viewWall": "모아보기",
    "zoomQr": "QR 코드 확대",
    "putBack": "돌려놓기",
    "homeCtaTitle": "이제 당신 차례예요.",
    "homeCtaText": "회원가입 없이 지금 바로 수정해 보세요.",
    "drawCtaTitle": "다음",
    "drawCtaText": "탭하여 다른 사람 보기.",
    "drawWhere": "무작위로 뽑은 다른 사람들의 Cards",
    "tryNow": "지금 사용해 보기",
    "mdOf": "{n}장 중 {i}번째",
    "fileEndTitle": "여기까지입니다.",
    "fileEndText": "파일 하나에 {n}장.",
    "makeYourOwn": "직접 만들기",
    "fileNote": "단일 파일. 25MB 미만."
  },
  "zh-Hans": {
    "mdOf": "第 {i} 张，共 {n} 张",
    "fileEndTitle": "就这些。",
    "fileEndText": "一个文件，{n} 张。",
    "makeYourOwn": "制作属于自己的",
    "fileNote": "一个文件，不足 25 MB。"
  },
  "de": {
    "viewStack": "Stapel",
    "viewList": "Liste",
    "viewWall": "Wand",
    "zoomQr": "QR-Code vergrößern",
    "putBack": "Zurücklegen",
    "homeCtaTitle": "Sie sind dran.",
    "homeCtaText": "Keine Registrierung. Jetzt anpassen.",
    "drawCtaTitle": "Weiter",
    "drawCtaText": "Antippen für jemand anderen.",
    "drawWhere": "Cards anderer Personen, zufällig ausgewählt",
    "tryNow": "Jetzt testen",
    "mdOf": "{i} von {n}",
    "fileEndTitle": "Das ist alles.",
    "fileEndText": "{n} in einer Datei.",
    "makeYourOwn": "Eigene erstellen",
    "fileNote": "Eine Datei. Unter 25 MB."
  },
  "fr": {
    "viewStack": "Pile",
    "viewList": "Liste",
    "viewWall": "Mur",
    "zoomQr": "Agrandir le code QR",
    "putBack": "Replacer",
    "homeCtaTitle": "À vous de jouer.",
    "homeCtaText": "Sans inscription. Commencez à modifier dès maintenant.",
    "drawCtaTitle": "Suivant",
    "drawCtaText": "Appuyez pour voir quelqu'un d'autre.",
    "drawWhere": "Des Cards d'autres personnes, choisies au hasard",
    "tryNow": "Essayer",
    "mdOf": "{i} sur {n}",
    "fileEndTitle": "C’est tout.",
    "fileEndText": "{n} dans un seul fichier.",
    "makeYourOwn": "Créer le vôtre",
    "fileNote": "Un seul fichier. Moins de 25 Mo."
  },
  "es": {
    "viewStack": "Pila",
    "viewList": "Lista",
    "viewWall": "Muro",
    "zoomQr": "Ampliar el código QR",
    "putBack": "Volver a colocar",
    "homeCtaTitle": "Tu turno.",
    "homeCtaText": "Sin registro. Comienza a editar ahora.",
    "drawCtaTitle": "Siguiente",
    "drawCtaText": "Toca para ver a otra persona.",
    "drawWhere": "Cards de otras personas, elegidas al azar",
    "tryNow": "Probar ahora",
    "mdOf": "{i} de {n}",
    "fileEndTitle": "Eso es todo.",
    "fileEndText": "{n} en un solo archivo.",
    "makeYourOwn": "Crear uno propio",
    "fileNote": "Un solo archivo. Menos de 25 MB."
  },
  "pt": {
    "viewStack": "Pilha",
    "viewList": "Lista",
    "viewWall": "Mural",
    "zoomQr": "Ampliar código QR",
    "putBack": "Colocar de volta",
    "homeCtaTitle": "Sua vez.",
    "homeCtaText": "Sem cadastro. Comece a editar agora.",
    "drawCtaTitle": "Próximo",
    "drawCtaText": "Toque para ver outra pessoa.",
    "drawWhere": "Cards de outras pessoas, escolhidos aleatoriamente",
    "tryNow": "Testar agora",
    "mdOf": "{i} de {n}",
    "fileEndTitle": "Isso é tudo.",
    "fileEndText": "{n} em um único arquivo.",
    "makeYourOwn": "Crie o seu",
    "fileNote": "Um único arquivo. Menos de 25 MB."
  }
};
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
