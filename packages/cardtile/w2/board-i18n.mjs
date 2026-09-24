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
// 「＋加一張牌」 at the end of a lane, the phone's two bottom tabs, and the words that say
// which tile opens which drawer. Nine locales, key-first for the same reason cell-i18n.mjs is: adding a string means touching
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
  // ── the drawer: the preview's chip into it, and the board's words for which tile opens it ──────
  //
  // 🔴 The drawer keeps the word 「抽屜」 (CARD-VOCAB-ADDENDUM-2026-09-06). The THING you touch is a
  // 牌; the LANE is a lane; the second-level card is a 抽屜. Three words, three meanings, no overlap.
  'board.opensDrawer': {
    zh: '牽到抽屜', ja: '引き出しへつながる', en: 'Opens a drawer', ko: '서랍으로 이어져요',
    'zh-Hans': '牵到抽屉', de: 'Öffnet eine Schublade', fr: 'Ouvre un tiroir',
    es: 'Abre un cajón', pt: 'Abre uma gaveta',
  },
  // ── the drawer relation, said in WORDS (owner ruling 2026-09-24: "a view answers one question";
  // a one-to-one relation does not need a line, a word does). The dashed 牽線 lines are gone; the
  // tile says where it goes and the drawer lane says who opens it. `{title}` / `{by}` are slots.
  'board.opensLabel': {
    zh: '→ 開啟：{title}', ja: '→ 開く：{title}', en: '→ Opens: {title}', ko: '→ 열기: {title}',
    'zh-Hans': '→ 打开：{title}', de: '→ Öffnet: {title}', fr: '→ Ouvre : {title}',
    es: '→ Abre: {title}', pt: '→ Abre: {title}',
  },
  'board.drawerOpenedBy': {
    zh: '{title}（由〈{by}〉打開）', ja: '{title}（〈{by}〉から開く）', en: '{title} (opened by “{by}”)',
    ko: '{title} (〈{by}〉에서 열림)', 'zh-Hans': '{title}（由〈{by}〉打开）',
    de: '{title} (geöffnet von „{by}“)', fr: '{title} (ouvert par « {by} »)',
    es: '{title} (lo abre «{by}»)', pt: '{title} (aberto por “{by}”)',
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
  // ── HOST MODE: the save status beside 「存」 (feelreef embeds the editor on a real card) ──────
  // The Save button itself reuses the chrome's `pubSave`, already in all nine.
  // shown until the parent page hands the card over (host-bridge re-announces card:ready meanwhile)
  'board.hostWaiting': {
    zh: '等待頁面回應…', ja: 'ページの応答を待っています…', en: 'Waiting for the page…', ko: '페이지를 기다리는 중…',
    'zh-Hans': '等待页面响应…', de: 'Warte auf die Seite…', fr: 'En attente de la page…', es: 'Esperando a la página…', pt: 'Aguardando a página…',
  },
  'board.hostUnsaved': {
    zh: '尚未儲存', ja: '未保存', en: 'Unsaved', ko: '저장 안 됨',
    'zh-Hans': '尚未保存', de: 'Nicht gespeichert', fr: 'Non enregistré', es: 'Sin guardar', pt: 'Não salvo',
  },
  'board.hostSaving': {
    zh: '儲存中…', ja: '保存中…', en: 'Saving…', ko: '저장 중…',
    'zh-Hans': '保存中…', de: 'Wird gespeichert…', fr: 'Enregistrement…', es: 'Guardando…', pt: 'Salvando…',
  },
  'board.hostSaved': {
    zh: '已儲存', ja: '保存しました', en: 'Saved', ko: '저장됨',
    'zh-Hans': '已保存', de: 'Gespeichert', fr: 'Enregistré', es: 'Guardado', pt: 'Salvo',
  },
  'board.hostFailed': {
    zh: '儲存失敗', ja: '保存できませんでした', en: 'Not saved', ko: '저장 실패',
    'zh-Hans': '保存失败', de: 'Nicht gespeichert – Fehler', fr: 'Échec de l’enregistrement', es: 'No se pudo guardar', pt: 'Falha ao salvar',
  },
  // ── the editor bar's view switch: 卡 · board · Markdown ───────────────────────────────────────
  // The board word follows the engine host's own (ja 「ボード」, ko 「보드」 in its viewSwitchAction).
  'board.viewBoard': {
    zh: '牌桌', ja: 'ボード', en: 'Board', ko: '보드',
    'zh-Hans': '牌桌', de: 'Board', fr: 'Tableau', es: 'Tablero', pt: 'Quadro',
  },
  // plain "Markdown": the segment is a view name; chrome `mdMode` ("Markdown 模式") is the sheet title
  'board.viewMd': {
    zh: 'Markdown', ja: 'Markdown', en: 'Markdown', ko: 'Markdown',
    'zh-Hans': 'Markdown', de: 'Markdown', fr: 'Markdown', es: 'Markdown', pt: 'Markdown',
  },
  // the finished card beside the table (≥1024) — its accessible name. Ruler #3 (2026-09-24): no
  // "preview" to a person; it is the card, as it will be seen.
  'board.previewTitle': {
    zh: '完成的卡片', ja: '仕上がったカード', en: 'The finished card', ko: '완성된 카드',
    'zh-Hans': '完成的卡片', de: 'Die fertige Karte', fr: 'La carte finie',
    es: 'La tarjeta terminada', pt: 'O cartão pronto',
  },
  // the editing table itself — the iframe's accessible name
  'board.tableTitle': {
    zh: '編輯桌', ja: '編集テーブル', en: 'Editing table', ko: '편집 테이블',
    'zh-Hans': '编辑桌', de: 'Bearbeitungstisch', fr: 'Table d’édition',
    es: 'Mesa de edición', pt: 'Mesa de edição',
  },
  // ── the three questions (owner rule 2: every screen says what it is, what you can do, what
  // happens next). One line under each view's heading, and the picker's destination. `{front}` /
  // `{back}` are the chrome's own faceTabLabel / mdBack, so the sentence names what the screen shows.
  'board.tableHint': {
    zh: '整張卡的每一張牌都在這裡。拖動可以換順序，點一下可以修改。「{front}」是訪客先看到的；其他欄是抽屜，由某張牌打開。',
    ja: 'カードのタイルがすべてここに並びます。ドラッグで並べ替え、タップで編集。「{front}」は最初に見える面、ほかの列はタイルから開く引き出しです。',
    en: 'Every tile on your card, in order. Drag to reorder; tap one to change it. “{front}” is what visitors see first; the other lanes are drawers a tile opens.',
    ko: '카드의 모든 타일이 여기 있어요. 끌어서 순서를 바꾸고, 눌러서 고쳐요. 「{front}」은 방문자가 먼저 보는 곳, 다른 줄은 타일이 여는 서랍이에요.',
    'zh-Hans': '整张卡的每一张牌都在这里。拖动可以换顺序，点一下可以修改。「{front}」是访客先看到的；其他栏是抽屉，由某张牌打开。',
    de: 'Alle Kacheln Ihrer Karte, der Reihe nach. Ziehen zum Umsortieren, antippen zum Ändern. „{front}“ sehen Besucher zuerst; die anderen Spalten sind Schubladen, die eine Kachel öffnet.',
    fr: 'Toutes les tuiles de votre carte, dans l’ordre. Glissez pour réordonner, touchez pour modifier. « {front} » est ce que les visiteurs voient d’abord ; les autres colonnes sont des tiroirs qu’une tuile ouvre.',
    es: 'Todas las fichas de tu tarjeta, en orden. Arrastra para reordenar; toca una para cambiarla. «{front}» es lo que se ve primero; las demás columnas son cajones que abre una ficha.',
    pt: 'Todas as peças do seu cartão, em ordem. Arraste para reordenar; toque em uma para mudá-la. “{front}” é o que as visitas veem primeiro; as outras colunas são gavetas que uma peça abre.',
  },
  'board.mdLead': {
    zh: '這是你整張卡片寫成文字的樣子。在這裡改字，卡片會跟著變；按「{back}」時會先檢查一遍，看不懂的地方不會套用。',
    ja: 'カード全体を文字で書いたものです。ここで書き換えるとカードも変わります。「{back}」を押すと先に確認し、読み取れない部分は反映しません。',
    en: 'This is your whole card, written out as text. Change it here and the card follows; “{back}” checks it first and changes nothing it can’t read.',
    ko: '카드 전체를 글로 적어 둔 거예요. 여기서 고치면 카드도 따라 바뀌어요. 「{back}」를 누르면 먼저 확인하고, 읽을 수 없는 부분은 적용하지 않아요.',
    'zh-Hans': '这是你整张卡片写成文字的样子。在这里改字，卡片会跟着变；按「{back}」时会先检查一遍，看不懂的地方不会应用。',
    de: 'Das ist Ihre ganze Karte als Text. Ändern Sie ihn hier, folgt die Karte; „{back}“ prüft zuerst und ändert nichts, was es nicht lesen kann.',
    fr: 'Voici toute votre carte, écrite en texte. Modifiez-la ici et la carte suit ; « {back} » vérifie d’abord et ne change rien qu’il ne sait pas lire.',
    es: 'Esta es toda tu tarjeta escrita como texto. Cámbiala aquí y la tarjeta la sigue; «{back}» lo revisa antes y no cambia nada que no entienda.',
    pt: 'Este é o seu cartão inteiro, escrito como texto. Mude aqui e o cartão acompanha; “{back}” confere antes e não muda nada que não consiga ler.',
  },
  // under 「要加哪一種？」: where the new tile lands, so tapping one is not a leap
  'board.pickWhere': {
    zh: '點一種，它會加在「{lane}」的最後面。',
    ja: '選ぶと「{lane}」のいちばん最後に追加されます。',
    en: 'Tap one and it goes at the end of “{lane}”.',
    ko: '하나를 누르면 「{lane}」 맨 끝에 추가돼요.',
    'zh-Hans': '点一种，它会加在「{lane}」的最后面。',
    de: 'Tippen Sie eine an – sie kommt ans Ende von „{lane}“.',
    fr: 'Touchez-en une : elle s’ajoute à la fin de « {lane} ».',
    es: 'Toca una y se añade al final de «{lane}».',
    pt: 'Toque em uma e ela entra no fim de “{lane}”.',
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
