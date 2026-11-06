// The Card editor's own words (w3/edit3.mjs): the row, the sheets' titles, Cards settings, the deck
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
  untitled: 'Untitled', options: 'Cards settings', settingsBack: 'Settings', viewsAria: 'Views', wallFrame: 'Wall', editBtn: 'Edit', raw: 'Raw content',
  docTitle: '{t} · Editing Cards', pageTitle: 'Edit Cards',
  bcValue: 'Name + QR code',
  dfSays: 'The back of every tile that has none of its own.', replaceBack: 'Replace…', toBc: 'Back to the default', toBcDone: 'The default back is back.',
  titleL: 'Title', titleFromProfile: 'Your profile shows this name too.', rawSays: 'The whole file, exactly as it is stored.', openRaw: 'Edit raw content', bcL: 'Default back',
  previewFrame: 'What visitors see',
  addTile: 'Add a tile', pickHint: 'Pick one to start. You can change it later.',
  deleteTile: 'Delete tile', done: 'Done', close: 'Close', undo: 'Undo',
  backInRaw: 'Edit this back in Raw content', editTile: 'Edit tile', addBetween: 'Add a tile between {a} and {b}',
  front: 'Front', back: 'Back', pairOn: 'Pair as front and back', pairOff: 'Unpair',
  text: 'Text', deleted: 'Tile deleted',
  backdrop: 'Backdrop', backdropHint: 'A picture behind your Cards.', bdNone: 'None', bdSet: 'A picture',
  bdPick: 'Choose a picture…', bdUrl: 'Picture address', bdRemove: 'Remove backdrop',
  dim: 'Dim backdrop', dim0: 'None', dim25: 'Light', dim45: 'Medium', dim65: 'Dark', dimHint: 'Keeps text readable over the picture.', auto: 'Auto',
  viewStack: 'Stack', viewList: 'List', viewWall: 'Wall',
  viewSaysStack: 'Flip through', viewSaysList: 'Scroll through all', viewSaysWall: 'See the whole page',
  viewsLabel: 'How visitors can view', opensAs: 'Opens as', full: 'Full', width: 'Width',
  save: 'Save', savedLive: 'Saved. It is live now.',
  // the assistant palette (⌘K and the sparkle button): a stand-in that changes nothing yet
  seek: 'Ask the assistant', palPh: 'Tell the assistant what to do…',
  palSays: 'Not connected yet. Once it is, what it changes goes into your draft, and nothing is live until you press Save.',
  palEcho: 'You said: “{q}”. Nothing was changed.',
  accentL: 'Main colour', accentSays: 'Pick one colour; the rest of the palette follows from it.', accentReset: 'Reset', accentCustom: 'Custom colour',
  themeL: 'Light or dark', themeAutoSays: '“Auto” follows each visitor’s device.', themeAuto: 'Auto', themeLight: 'Light', themeDark: 'Dark',
  backupL: 'Backup', backupSays: 'Download your Cards as one file.', download: 'Download as a file', replaceFile: 'Replace everything with a file…',
  replaceSays: 'It replaces the unsaved draft; nothing counts until you press Save.', replaceAsk: 'Everything here will be replaced by the file.', replaceGo: 'Choose a file and replace',
  resetAsk: 'Clear the Cards in this browser?', resetSays: 'Clears the Cards in this browser and starts again from blank.',
  dangerSays: 'Replacing changes only the unsaved draft, and starting over clears the Cards in this browser.',
  replaced: 'Replaced with the file: {a} → {b}.', badFile: 'Line {n} has an error to fix. Nothing was changed.',
  secName: 'Name and address', secLook: 'Look', secViewsBack: 'Views and back', secFound: 'Being found', secMore: 'More',
  viewsL: 'Views', viewsKeepOne: 'Keep at least one.', listSep: ', ',
  handleL: 'Address', handleSays: 'The QR code on the default back opens this address.', change: 'Change',
  newHandle: 'New address', handleWarn: 'reef.cards/{o} stops working the moment you change it and anyone can take it, so links, QR codes and prints with it will lead elsewhere.',
  typeOld: 'Type {o} to let it go', doChange: 'Change address', cancel: 'Cancel', handleDone: 'Your Cards are now at reef.cards/{h}.',
  hShape: '1–39 lowercase letters, digits or hyphens, starting with a letter or digit.', hReserved: 'That one is reserved.',
  handleHere: 'The address is changed in your Cards list, not here.',
  domainL: 'Your own domain', domainSays: 'Visitors open your Cards at your domain instead.', connect: 'Connect a domain', domainNone: 'Not connected',
  headerL: 'Header', headerCentre: 'Centred', headerLeft: 'Avatar left',
  iconsL: 'Icons', iconsColour: 'Colour', iconsMono: 'Grey',
  poolL: 'In the card pool',
  poolOn: 'Anyone drawing at reef.cards may get your Cards, and they appear on the feelreef home page. In return, the last tile and the footer link to reef.cards.',
  poolOff: 'Only people with the address see your Cards. Nothing links to reef.cards.',
  transferL: 'Transfer',
  notYet: 'Not available yet',
  // host mode (the editor inside the dashboard): what Save is doing, and the page that never answered
  hostWaiting: 'Waiting for the page…', hostSaving: 'Saving…', hostFailed: 'Not saved', colon: ': ',
  hostLoadFailed: 'This page could not open your Cards. Reload to try again.', reload: 'Reload',
  proposed: 'A suggested change is in your draft. Nothing is live until you press Save.',
  // leaving the row or the wall with something unsaved
  leaveTitle: 'You have unsaved changes', leaveKeep: 'Keep editing', leaveDiscard: 'Discard',
  // the sandbox's sign-in entry, first in Cards settings (it opens the same door Save does)
  signIn: 'Sign in', signInSays: 'Once you are signed in, Save puts it online, and you can find it on any device. What is here comes with you.',
  sbxStatus: 'Not signed in yet, so for now it is kept in this browser only.',
  // a sheet whose Done waits for a field
  required: 'Required', needs: 'Fill in “{f}” to finish',
  // the social-icons form
  socialNet: 'Network', socialLink: 'Link or @handle', socialAdd: 'Add another', socialRemove: 'Remove', socialWeb: 'Website', socialEmail: 'Email',
  more: 'More', help: 'What is this?',
};

const ZH = {
  untitled: '未命名', options: 'Cards 設定', settingsBack: '設定', viewsAria: '看法', wallFrame: '牆', editBtn: '編輯', raw: '原始內容',
  docTitle: '{t} · 編輯 Cards', pageTitle: '編輯 Cards',
  bcValue: '名字＋QR code',
  dfSays: '沒有自己背面的卡牌，翻過來都是它。', replaceBack: '換掉…', toBc: '換回預設', toBcDone: '換回預設背面了。',
  titleL: '標題', titleFromProfile: '你的個人檔案也顯示這個名字。', rawSays: '整份檔案，跟存的一模一樣。', openRaw: '編輯原始內容', bcL: '預設背面',
  previewFrame: '訪客看到的樣子',
  addTile: '加一張卡牌', pickHint: '選一種開始，之後都還能改。',
  deleteTile: '刪除這張卡牌', done: '完成', close: '關閉', undo: '復原',
  backInRaw: '到原始內容修改這個背面', editTile: '編輯這張卡牌', addBetween: '在第 {a} 和第 {b} 張之間加一張',
  front: '正面', back: '背面', pairOn: '接成正反面', pairOff: '拆開正反面',
  text: '文字', deleted: '刪掉了一張卡牌',
  backdrop: '整面背景', backdropHint: '放在你的 Cards 後面的圖。', bdNone: '沒有', bdSet: '一張圖',
  bdPick: '選擇圖片…', bdUrl: '圖片網址', bdRemove: '移除背景',
  dim: '背景暗度', dim0: '不調暗', dim25: '淡', dim45: '中', dim65: '深', dimHint: '讓字在圖上讀得清楚。', auto: '自動',
  viewStack: '疊', viewList: '攤', viewWall: '牆',
  viewSaysStack: '翻著看', viewSaysList: '一次攤開', viewSaysWall: '整頁排好',
  viewsLabel: '訪客可以怎麼看', opensAs: '一打開看到', full: '全寬', width: '寬度',
  save: '儲存', savedLive: '存好了，已經上線。',
  seek: '問助理', palPh: '跟助理說要做什麼…',
  palSays: '還沒接上。接上之後，它改的東西會放進你的草稿，你按「儲存」才會上線。',
  palEcho: '你說：「{q}」。什麼都沒改。',
  accentL: '主色', accentSays: '選一個顏色，其他配色從它推出來。', accentReset: '還原預設', accentCustom: '自訂顏色',
  themeL: '亮色或暗色', themeAutoSays: '「自動」跟著訪客的系統。', themeAuto: '自動', themeLight: '亮', themeDark: '暗',
  backupL: '備份', backupSays: '把你的 Cards 下載成一個檔案。', download: '下載成檔案', replaceFile: '用檔案全部換掉…',
  replaceSays: '換掉的是還沒儲存的草稿，按儲存才算數。', replaceAsk: '目前的內容會被檔案整個換掉。', replaceGo: '選擇檔案並換掉',
  resetAsk: '清空這個瀏覽器裡的 Cards？', resetSays: '清空這個瀏覽器裡的 Cards，從空白開始。',
  dangerSays: '換掉的是還沒儲存的草稿，按儲存才算數；重新開始會清空這個瀏覽器裡的 Cards。',
  replaced: '換成檔案的內容了：{a} → {b}。', badFile: '第 {n} 行有錯誤，需要調整。什麼都沒改。',
  secName: '名字與網址', secLook: '外觀', secViewsBack: '看法與背面', secFound: '被看見', secMore: '更多',
  viewsL: '看法', viewsKeepOne: '至少留一種。', listSep: '、',
  handleL: '網址', handleSays: '預設背面上的 QR code 打開的就是這個網址。', change: '更改',
  newHandle: '新網址', handleWarn: '一改，reef.cards/{o} 就立刻失效、任何人都能拿走，分享過的連結、QR code 和印出去的東西都會連到別處。',
  typeOld: '輸入 {o}，確定放掉它', doChange: '改網址', cancel: '取消', handleDone: '你的 Cards 現在在 reef.cards/{h}。',
  hShape: '1 到 39 個小寫英文字母、數字或連字號，開頭要是字母或數字。', hReserved: '這個網址保留了，不能用。',
  handleHere: '網址在你的 Cards 列表裡改，不在這裡。',
  domainL: '自己的網域', domainSays: '訪客改用你的網域打開你的 Cards。', connect: '接上網域', domainNone: '未接上',
  headerL: '頭部排法', headerCentre: '置中', headerLeft: '頭像靠左',
  iconsL: '圖示', iconsColour: '彩色', iconsMono: '灰階',
  poolL: '放進卡牌池',
  poolOn: '別人在 reef.cards 抽的時候可能抽到你的 Cards，feelreef 首頁也看得到。換來的是：最後一張卡牌和頁尾會放 reef.cards 的連結。',
  poolOff: '只有知道網址的人看得到，也不會放 reef.cards 的連結。',
  transferL: '轉移給別人',
  notYet: '還沒開放',
  hostWaiting: '等待頁面回應…', hostSaving: '儲存中…', hostFailed: '儲存失敗', colon: '：',
  hostLoadFailed: '這個頁面打不開你的 Cards，請重新整理再試一次。', reload: '重新整理',
  proposed: '有一份建議的修改放進你的草稿了。按「儲存」才會上線。',
  leaveTitle: '有還沒儲存的修改', leaveKeep: '繼續編輯', leaveDiscard: '放棄修改',
  signIn: '登入', signInSays: '登入後，存好就上線，換台裝置也找得到。這裡的內容會跟著帶過去。',
  sbxStatus: '還沒登入，現在只存在這個瀏覽器裡。',
  required: '必填', needs: '填好「{f}」才能完成',
  socialNet: '平台', socialLink: '連結或 @帳號', socialAdd: '再加一個', socialRemove: '移除', socialWeb: '網站', socialEmail: '電子郵件',
  more: '更多', help: '這是什麼？',
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
