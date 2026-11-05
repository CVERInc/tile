// The Card editor's own words (w3/edit3.mjs): the row, the sheets' titles, Cards options, the deck
// view names, Save, and host mode's status line. The SHEET's field labels are cell-i18n.mjs's, and
// the shared chrome (Done, Undo, the picture picker…) is sandbox-i18n.mjs's CHROME_STRINGS — this
// table only holds what those two did not already say.
//
// Keyed by the sandbox's nine locale keys. `en` and `zh` (Traditional) are complete. For the other
// seven, a string is given only where a sibling table already says the same thing in that language
// (SAME_AS_CHROME below, and the host status words, which w2's board table carried in all nine);
// everything else falls back to English key by key, and EDIT3_MISSING lists exactly which.
//
// Placeholders are `{name}`, filled by fmt(). Every value is a plain string, so the banned-word scan
// (w3/words.test.mjs) sees all of it.
import { LOCALE_KEYS, CHROME_STRINGS, primaryLocale } from '../w/sandbox-i18n.mjs';

const EN = {
  untitled: 'Untitled', options: 'Cards options', viewsAria: 'Views', wallFrame: 'Wall', editBtn: 'Edit', raw: 'Raw content',
  docTitle: '{t} · Editing Cards', pageTitle: 'Edit Cards', turn: 'Turn over', writeBack: 'Write on the back', peel: 'Peel off', sideUp: 'This side up',
  bcSays: 'The back of every tile that has none of its own. Out of the box it is your business card: the name is the title above, and the code opens these Cards.',
  dfSays: 'The back of every tile that has none of its own.', replaceBack: 'Replace', toBc: 'Back to the business card', toBcDone: 'The business card is back.',
  linkSays: 'A link turns over to where it goes.', bcCard: 'The default back. Replace it in Cards options.', ytSays: 'A video turns over to its page on YouTube.', ytPill: 'Watch on YouTube',
  titleL: 'Title', titleFromProfile: 'Your profile shows this name too.', rawSays: 'The whole file, exactly as it is stored.', openRaw: 'Open raw content', bcL: 'Default back',
  previewFrame: 'What visitors see',
  addTile: 'Add a tile', pickHint: 'Pick one to start. You can change it later.',
  deleteTile: 'Delete tile', done: 'Done', close: 'Close', undo: 'Undo',
  backInRaw: 'Edit this back in Raw content', editTile: 'Edit tile', addBetween: 'Add a tile between {a} and {b}',
  front: 'Front', back: 'Back', pair: 'Pair as front and back', firstTile: 'Tap + to add your first tile',
  free: 'Raw content', freeHint: 'Write it yourself. What you write is what shows.', freeModal: 'What you write here is what the tile shows.', toFree: 'Switch to Raw content',
  text: 'Text', deleted: 'Tile deleted',
  setHint: 'What belongs to these Cards as a whole.', backdrop: 'Backdrop', backdropHint: 'An image behind these Cards.',
  dim: 'Dim backdrop', dim0: 'None', dim25: 'Light', dim45: 'Medium', dim65: 'Dark', dimHint: 'Keeps text readable over the image.', auto: 'Auto',
  viewStack: 'Stack', viewList: 'List', viewWall: 'Wall',
  viewSaysStack: 'Flip one at a time', viewSaysList: 'Scroll through all', viewSaysWall: 'See the whole page',
  viewsLabel: 'How visitors can view', opensAs: 'Opens as', full: 'Full', width: 'Width',
  save: 'Save', savedLive: 'Saved. It is live now.', savedLocal: 'Saved in this browser.', unsaved: 'Unsaved changes',
  // the assistant palette (⌘K and the magnifier): a stand-in that changes nothing yet
  seek: 'Ask the assistant or search', palPh: 'Tell the assistant what to do, or search…',
  palSays: 'Not connected yet. Once it is, what it changes goes into your draft, and nothing is live until you press Save.',
  palEcho: 'You said: “{q}”. Nothing was changed.',
  accentL: 'Main colour', accentSays: 'Pick one colour; the rest of the palette follows from it.', accentReset: 'Default',
  themeL: 'Light or dark', themeAuto: 'Follow the visitor', themeLight: 'Light', themeDark: 'Dark',
  backupL: 'Backup', backupSays: 'Download these Cards as one file, or replace all of it with a file you have.', download: 'Download', replaceFile: 'Replace with a file',
  replaced: 'Replaced with the file: {a} tiles → {b}.', badFile: 'That file cannot be read (line {n}). Nothing was changed.',
  secName: 'Name and address', secLook: 'Look', secViews: 'Views', secBack: 'Back', secFound: 'Being found', secMore: 'More',
  handleL: 'Address', handleSays: 'The QR code on your business card opens this address.', change: 'Change',
  newHandle: 'New address', handleWarn: 'reef.cards/{o} stops working the moment you change it, and anyone can take it. Links you shared, QR codes and anything printed with the old address will lead to someone else, or nowhere.',
  typeOld: 'Type {o} to let it go', doChange: 'Change address', cancel: 'Cancel', handleDone: 'Your Cards are now at reef.cards/{h}.',
  hShape: '1–39 lowercase letters, digits or hyphens, starting with a letter or digit.', hReserved: 'That one is reserved.', hSame: 'That is the address you have.',
  handleHere: 'The address is changed in your Cards list, not here.',
  domainL: 'Your own domain', domainSays: 'Visitors open these Cards at your domain instead.', connect: 'Connect a domain',
  headerL: 'Header', headerCentre: 'Centred', headerLeft: 'Avatar on the left',
  iconsL: 'Icons', iconsColour: 'Colour', iconsMono: 'Grey',
  poolL: 'In the card pool', poolNameOn: 'On', poolNameOff: 'Off',
  poolOn: 'Anyone drawing at reef.cards may get these Cards, and they appear on the feelreef home page. In return, the last card and the footer link to reef.cards.',
  poolOff: 'Only people with the address see these Cards. Nothing links to reef.cards.',
  transferL: 'Transfer', transferSays: 'Give these Cards to another account. The address goes with them.',
  notYet: 'Not available yet',
  // host mode (the editor inside the dashboard): what the Save button is doing
  hostWaiting: 'Waiting for the page…', hostSaving: 'Saving…', hostFailed: 'Not saved',
  proposed: 'A suggested change is in your draft. Nothing is live until you press Save.',
};

const ZH = {
  untitled: '未命名', options: 'Cards 設定', viewsAria: '看法', wallFrame: '牆', editBtn: '編輯', raw: '原始內容',
  docTitle: '{t} · 編輯 Cards', pageTitle: '編輯 Cards', turn: '翻面', writeBack: '寫上背面', peel: '撕開', sideUp: '這面朝上',
  bcSays: '每張沒有自己背面的卡牌，背後都是它。出廠時是你的名片：名字是上面的標題，QR code 打開這組 Cards。',
  dfSays: '每張沒有自己背面的卡牌，背後都是它。', replaceBack: '換掉', toBc: '換回名片', toBcDone: '名片換回來了。',
  linkSays: '連結翻過來，是它要去的地方。', bcCard: '預設背面。到 Cards 設定換掉。', ytSays: '影片翻過來，是它在 YouTube 的頁面。', ytPill: '到 YouTube 看',
  titleL: '標題', titleFromProfile: '你的 profile 也顯示這個名字。', rawSays: '整份檔案，跟存的一模一樣。', openRaw: '打開原始內容', bcL: '預設背面',
  previewFrame: '訪客看到的樣子',
  addTile: '加一張卡牌', pickHint: '選一種開始，之後都還能改。',
  deleteTile: '刪除這張卡牌', done: '完成', close: '關閉', undo: '復原',
  backInRaw: '到原始內容修改這個背面', editTile: '編輯這張卡牌', addBetween: '在第 {a} 和第 {b} 張之間加一張',
  front: '正面', back: '背面', pair: '把這兩張接成正反面', firstTile: '按＋，加上第一張卡牌',
  free: '原始內容', freeHint: '自己寫，寫什麼就顯示什麼。', freeModal: '寫什麼，卡牌上就是什麼。', toFree: '改用原始內容',
  text: '文字', deleted: '刪掉了一張卡牌',
  setHint: '屬於整組 Cards 的設定。', backdrop: '整面背景', backdropHint: '放在整組 Cards 後面的一張圖。',
  dim: '背景暗度', dim0: '不調暗', dim25: '淡', dim45: '中', dim65: '深', dimHint: '讓字在圖上讀得清楚。', auto: '自動',
  viewStack: '疊', viewList: '攤', viewWall: '牆',
  viewSaysStack: '一張一張翻', viewSaysList: '一次攤開', viewSaysWall: '整頁排好',
  viewsLabel: '訪客可以怎麼看', opensAs: '一打開看到', full: '全寬', width: '寬度',
  save: '儲存', savedLive: '存好了，已經上線。', savedLocal: '存在這個瀏覽器裡了。', unsaved: '有還沒儲存的修改',
  seek: '問助理，或搜尋', palPh: '跟助理說要做什麼，或搜尋…',
  palSays: '還沒接上。接上之後，它改的東西會放進你的草稿，你按「儲存」才會上線。',
  palEcho: '你說：「{q}」。什麼都沒改。',
  accentL: '主色', accentSays: '選一個顏色，其他配色從它推出來。', accentReset: '預設',
  themeL: '亮色或暗色', themeAuto: '跟著訪客', themeLight: '亮', themeDark: '暗',
  backupL: '備份', backupSays: '把這組 Cards 下載成一個檔案，或用手上的檔案整份換掉。', download: '下載', replaceFile: '用檔案整份換掉',
  replaced: '整份換成檔案了：{a} 張 → {b} 張。', badFile: '這個檔案讀不進來（第 {n} 行）。什麼都沒改。',
  secName: '名字與網址', secLook: '外觀', secViews: '看法', secBack: '背面', secFound: '被看見', secMore: '更多',
  handleL: '網址', handleSays: '名片上的 QR code 打開的就是這個網址。', change: '更改',
  newHandle: '新網址', handleWarn: '一改，reef.cards/{o} 就立刻失效，任何人都能馬上拿走。你分享過的連結、QR code、印出去的東西，都會連到別人那裡，或打不開。',
  typeOld: '輸入 {o}，確定放掉它', doChange: '改網址', cancel: '取消', handleDone: '這組 Cards 現在在 reef.cards/{h}。',
  hShape: '1 到 39 個小寫英文字母、數字或連字號，開頭要是字母或數字。', hReserved: '這個網址保留了，不能用。', hSame: '這就是你現在的網址。',
  handleHere: '網址在你的 Cards 列表裡改，不在這裡。',
  domainL: '自己的網域', domainSays: '訪客改用你的網域打開這組 Cards。', connect: '接上網域',
  headerL: '頭部排法', headerCentre: '置中', headerLeft: '頭像靠左',
  iconsL: '圖示', iconsColour: '彩色', iconsMono: '灰階',
  poolL: '放進卡牌池', poolNameOn: '開', poolNameOff: '關',
  poolOn: '別人在 reef.cards 抽牌時可能抽到這組 Cards，feelreef 首頁也看得到。換來的是：最後一張牌和頁尾會放 reef.cards 的連結。',
  poolOff: '只有知道網址的人看得到，也不會放 reef.cards 的連結。',
  transferL: '轉移給別人', transferSays: '把這組 Cards 交給另一個帳號，網址跟著走。',
  notYet: '還沒開放',
  hostWaiting: '等待頁面回應…', hostSaving: '儲存中…', hostFailed: '儲存失敗',
  proposed: '有一份建議的修改放進你的草稿了。按「儲存」才會上線。',
};

// Keys whose words the shared chrome table already has in every locale — the same button, the same
// meaning. Used for the seven locales this table does not write out (en and zh keep their own).
const SAME_AS_CHROME = { undo: 'undo', close: 'modalCloseAria', done: 'modalSave', deleteTile: 'modalDelete', addTile: 'addCellHeader', cancel: 'pubCancel', save: 'pubSave' };

// The host status words, from w2's board table (which carried them in all nine) — same three states.
const HOST = {
  ja: { hostWaiting: 'ページの応答を待っています…', hostSaving: '保存中…', hostFailed: '保存できませんでした' },
  ko: { hostWaiting: '페이지를 기다리는 중…', hostSaving: '저장 중…', hostFailed: '저장 실패' },
  'zh-Hans': { hostWaiting: '等待页面响应…', hostSaving: '保存中…', hostFailed: '保存失败' },
  de: { hostWaiting: 'Warte auf die Seite…', hostSaving: 'Wird gespeichert…', hostFailed: 'Nicht gespeichert – Fehler' },
  fr: { hostWaiting: 'En attente de la page…', hostSaving: 'Enregistrement…', hostFailed: 'Échec de l’enregistrement' },
  es: { hostWaiting: 'Esperando a la página…', hostSaving: 'Guardando…', hostFailed: 'No se pudo guardar' },
  pt: { hostWaiting: 'Aguardando a página…', hostSaving: 'Salvando…', hostFailed: 'Falha ao salvar' },
};

/** each locale's OWN strings (no fallback applied) — what the tests and the missing-key list read */
export const EDIT3_STRINGS = Object.fromEntries(LOCALE_KEYS.map((k) => {
  if (k === 'en') return [k, EN];
  if (k === 'zh') return [k, ZH];
  const chrome = CHROME_STRINGS[k] || {};
  const derived = Object.fromEntries(Object.entries(SAME_AS_CHROME).filter(([, c]) => chrome[c]).map(([key, c]) => [key, chrome[c]]));
  return [k, { ...derived, ...(HOST[k] || {}) }];
}));

export const EDIT3_KEYS = Object.keys(EN);

/** every (locale → keys) that falls back to English */
export const EDIT3_MISSING = Object.fromEntries(LOCALE_KEYS.filter((k) => k !== 'en')
  .map((k) => [k, EDIT3_KEYS.filter((key) => !(key in EDIT3_STRINGS[k]))])
  .filter(([, keys]) => keys.length));

/** the editor's words for a locale key or tag, English for anything that locale does not have */
export function editStrings(tagOrKey) {
  const k = primaryLocale(tagOrKey || 'en');
  return { ...EN, ...(EDIT3_STRINGS[k] || {}) };
}

/** '{a} of {b}' + {a: 1, b: 2} → '1 of 2'. A placeholder with no value is left as written. */
export const fmt = (s, vars = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
