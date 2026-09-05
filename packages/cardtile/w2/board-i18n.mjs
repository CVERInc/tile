// `/try/edit`'s OWN words — the handful of strings the tugtile table cannot supply.
//
// 🔴 SCOPE, so this does not quietly become a third locale table. Almost everything a visitor reads
// on `/try/edit` already has an owner:
//
//   · the seven tile kinds and every form field  → w/cell-i18n.mjs   (nine locales)
//   · the sheet, the banner, the door, Markdown mode → w/sandbox-i18n.mjs (nine locales)
//   · the board's own chrome (fold, search, the view cycle) → the ENGINE's i18n/*.json (FOUR)
//
// What is left is this file: the strings that exist because a Card board is not a kanban board —
// 「＋加一張牌」 at the end of a lane, the phone's two bottom tabs, and the two ends of a
// 牽線. Nine locales, key-first for the same reason cell-i18n.mjs is: adding a string means touching
// nine lines that are adjacent, not nine blocks that are pages apart.
//
// 🩸 THE ENGINE SPEAKS FOUR AND THIS SURFACE SPEAKS NINE. That gap is real and it is not papered
// over: `boardLocaleJson()` below serves the engine its NEAREST language (de/fr/es/pt → en-US,
// zh-Hans → zh-TW) and then overwrites, in the served JSON, the engine keys that are actually
// visible on a Card board. A German visitor therefore reads German for everything this product
// owns, and the engine's own tooltips in English — which is an honest degradation, and stated,
// rather than the raw i18n KEYS a missing file would have printed.

/** key → locale → string. The nine `sandbox-i18n.mjs` speaks; that file's LOCALE_KEYS is the SSOT. */
export const BOARD_STRINGS_BY_KEY = {
  // the one-row icon picker that opens from it
  'board.pickTitle': {
    zh: '要加哪一種？', ja: 'どの種類にしますか？', en: 'Which kind?', ko: '어떤 종류인가요?',
    'zh-Hans': '要加哪一种？', de: 'Welche Art?', fr: 'Quel type ?', es: '¿De qué tipo?',
    pt: 'De que tipo?',
  },
  // ── the phone's two tabs, along the bottom edge ───────────────────────────────────────────────
  //
  // 🩸 They replace ONE button that said 「看成品」 and then 「回桌上」 — 「桌」 is tugtile's metaphor
  // and the cold read caught it leaking into a link-page product in all three languages (「机に戻る」,
  // "Back to the table", §2.10). A toggle also has to be READ before you know where you are; two
  // tabs show it. Short by design: this is a 44px bar at the bottom of a 390px screen.
  'board.tabEdit': {
    zh: '編輯', ja: '編集', en: 'Edit', ko: '편집',
    'zh-Hans': '编辑', de: 'Bearbeiten', fr: 'Modifier', es: 'Editar', pt: 'Editar',
  },
  'board.tabCard': {
    zh: '成品', ja: '仕上がり', en: 'The card', ko: '완성본',
    'zh-Hans': '成品', de: 'Die Karte', fr: 'La carte', es: 'La tarjeta', pt: 'O cartão',
  },
  // ── 牽線: the two ends of the line between a tile and the drawer it opens ──────────────────────
  //
  // 🔴 The drawer keeps the word 「抽屜」 (CARD-VOCAB-ADDENDUM-2026-09-06). The THING you touch is a
  // 牌; the LANE is a lane; the second-level card is a 抽屜. Three words, three meanings, no overlap.
  'board.opensDrawer': {
    zh: '牽到抽屜', ja: '引き出しへつながる', en: 'Opens a drawer', ko: '서랍으로 이어져요',
    'zh-Hans': '牵到抽屉', de: 'Öffnet eine Schublade', fr: 'Ouvre un tiroir',
    es: 'Abre un cajón', pt: 'Abre uma gaveta',
  },
  'board.openedFrom': {
    zh: '從這張牌牽過來', ja: 'このカードからつながっています', en: 'Opened from a tile',
    ko: '이 카드에서 이어져요', 'zh-Hans': '从这张牌牵过来', de: 'Von einer Kachel geöffnet',
    fr: 'Ouvert depuis une tuile', es: 'Se abre desde una ficha', pt: 'Aberto a partir de uma peça',
  },
  // a link that names a drawer nobody made. Reported, not hidden — see board-bridge's drawerLinks.
  'board.danglingDrawer': {
    zh: '這張牌指向一個不存在的抽屜', ja: 'このカードは存在しない引き出しを指しています',
    en: 'This tile points at a drawer that does not exist', ko: '이 카드는 없는 서랍을 가리켜요',
    'zh-Hans': '这张牌指向一个不存在的抽屉',
    de: 'Diese Kachel zeigt auf eine Schublade, die es nicht gibt',
    fr: 'Cette tuile pointe vers un tiroir qui n’existe pas',
    es: 'Esta ficha apunta a un cajón que no existe',
    pt: 'Esta peça aponta para uma gaveta que não existe',
  },
  // the live preview beside the table (≥1024) — its accessible name
  'board.previewTitle': {
    zh: '成品預覽', ja: '仕上がりプレビュー', en: 'Live preview', ko: '완성본 미리보기',
    'zh-Hans': '成品预览', de: 'Live-Vorschau', fr: 'Aperçu en direct',
    es: 'Vista previa en vivo', pt: 'Pré-visualização ao vivo',
  },
  // the editing table itself — the iframe's accessible name
  'board.tableTitle': {
    zh: '編輯桌', ja: '編集テーブル', en: 'Editing table', ko: '편집 테이블',
    'zh-Hans': '编辑桌', de: 'Bearbeitungstisch', fr: 'Table d’édition',
    es: 'Mesa de edición', pt: 'Mesa de edição',
  },
};

export const BOARD_KEYS = Object.keys(BOARD_STRINGS_BY_KEY);

/**
 * 「＋加一張牌」 is DERIVED, not a tenth translation of it.
 *
 * 🔴 The owner's vocabulary ruling (CARD-VOCAB-ADDENDUM-2026-09-06) fixes these words —
 * zh-TW 「加一張牌」, ja 「タイルを追加」, en "Add a tile" — and `chromeStrings(locale).addCellHeader`
 * already IS that string, in all nine, because it is what the internal editor's (`w/editor.mjs`)
 * palette heading says. A
 * second table holding the same sentence is a sentence that will disagree with itself: this file
 * shipped one for an hour, and its Japanese said 「カードを追加」 — 「カード」, the word the ruling
 * replaces — while the palette next door said 「タイルを追加」.
 *
 * The only thing added here is the plus sign, and which one it is depends on the script: CJK sets
 * take the full-width ＋ so it occupies one em beside ideographs, everything else the ASCII "+ ".
 */
/**
 * The locale keys written in CJK scripts — where a full-width mark occupies one em beside an
 * ideograph and a half-width one leaves a hole.
 *
 * 🩸 It is exported because it was needed a second time and the second caller nearly grew its own
 * copy: the 牽線 badge hard-coded 「：」 and printed `Opens a drawer：More` at English readers (cold
 * read §4). Which punctuation a sentence takes is a property of the SCRIPT, so there is one list.
 */
export const CJK_LOCALES = new Set(['zh', 'zh-Hans', 'ja', 'ko']);

/** the colon a label takes in this locale — full-width for CJK, ASCII plus a space elsewhere */
export const colon = (localeKey) => (CJK_LOCALES.has(localeKey) ? '：' : ': ');

export const addTileLabel = (localeKey, chrome) => {
  const words = (chrome && chrome.addCellHeader) || 'Add a tile';
  return CJK_LOCALES.has(localeKey) ? `＋${words}` : `+ ${words}`;
};

/** key-first → a plain `key → string` table for one locale, English where a key is short. */
export function boardStrings(localeKey) {
  const out = {};
  for (const [key, byLocale] of Object.entries(BOARD_STRINGS_BY_KEY)) {
    out[key] = byLocale[localeKey] != null ? byLocale[localeKey] : byLocale.en;
  }
  return out;
}

/**
 * Our nine locale keys → the ENGINE's four locale files.
 *
 * 🔴 Nearest language, never a key. `hosts/web/tugtile/index.html` falls back to `t(k) => k` when a
 * locale JSON is missing, which prints `addTileBtn` at a person — so a Portuguese visitor must be
 * handed `en-US.json`, not a 404. What this mapping costs is honest and bounded: the engine's own
 * tooltips are in English for five of the nine. What it buys is that nothing on the board is ever
 * an identifier.
 */
export const ENGINE_LOCALE_FILE = {
  zh: 'zh-TW', 'zh-Hans': 'zh-TW', ja: 'ja-JP', ko: 'ko-KR',
  en: 'en-US', de: 'en-US', fr: 'en-US', es: 'en-US', pt: 'en-US',
};

/**
 * The engine locale JSON a given visitor gets, with the two keys THIS board actually asks somebody
 * to read and act on overwritten by nine-locale strings. `base` is the parsed engine file (see
 * ENGINE_LOCALE_FILE); `chrome` is `chromeStrings(localeKey)` from w/sandbox-i18n.mjs.
 *
 *   addTileBtn   the button at the end of a lane — 「＋加一張牌」, this file's own string
 *   addLaneBtn   the button at the end of the board. On a Card a new lane IS a new 抽屜, and the
 *                sandbox already has a nine-locale word for that button; using it means the two
 *                sandboxes cannot end up calling the same thing two different names.
 *
 * Everything else the engine draws is a tooltip on a control that is either inherited whole (fold,
 * search, the view cycle, the lock) or intercepted — see edit2.mjs's intercept table.
 */
export function boardLocaleJson(base, localeKey, chrome = {}) {
  return {
    ...base,
    addTileBtn: addTileLabel(localeKey, chrome),
    ...(chrome.addDrawerButton ? { addLaneBtn: chrome.addDrawerButton } : {}),
  };
}
