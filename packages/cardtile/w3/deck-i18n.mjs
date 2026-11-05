// The words the deck (w3/deck.js) puts in front of a VISITOR, in the card's own language — the
// card's `lang:` frontmatter, the same choice the renderer's own strings follow. Not the editor's
// words (those are w3/edit3-i18n.mjs) and not the renderer's (card-render.mjs `LABELS`).
//
// Keyed by the sandbox's nine locale keys (w/sandbox-i18n.mjs LOCALE_KEYS). A locale without its own
// entry for a key falls back to English, key by key; DECK_MISSING lists exactly which ones do.
import { LOCALE_KEYS, primaryLocale } from '../w/sandbox-i18n.mjs';

export const DECK_STRINGS = {
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

export const DECK_KEYS = Object.keys(DECK_STRINGS.en);

/** every (locale, key) that falls back to English — the list a translator works from */
export const DECK_MISSING = Object.fromEntries(LOCALE_KEYS.filter((k) => k !== 'en')
  .map((k) => [k, DECK_KEYS.filter((key) => !(DECK_STRINGS[k] && key in DECK_STRINGS[k]))])
  .filter(([, keys]) => keys.length));

/** the deck's words for a BCP-47 tag (a card's `lang:`) or a locale key, English for anything missing */
export function deckStrings(tagOrKey) {
  const k = primaryLocale(tagOrKey || 'en');
  return { ...DECK_STRINGS.en, ...(DECK_STRINGS[k] || {}) };
}
