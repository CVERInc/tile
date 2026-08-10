/**
 * REEF with Lingo — the site-install locale helpers, vendored from
 * reef apps/feelreef/src/lib/lingo/types.ts (the seam contract). Lingo's
 * designed install into a Site = three deliberately-distinct representations
 * (memory lingo-url-locale-codes):
 *   • DATA  — canonical mixed-case full code: en-US / ja-JP / zh-TW / ko-KR
 *   • URL   — lowercase full code in the path: /en-us/ /ja-jp/ …
 *   • ATTR  — BCP-47 for <html lang> + hreflang: en / ja / zh-Hant / ko
 *             (standards-correct: zh-Hant, NEVER zh-TW — the one place
 *              abbreviation is right). This is what a live Lingo site's <head> emits.
 * Never ABBREVIATE the data/URL code (no bare `zh`/`en`).
 */
export const LINGO_LOCALES = ['en-US', 'ja-JP', 'zh-TW', 'ko-KR'];
const LINGO_BCP47 = { 'en-US': 'en', 'ja-JP': 'ja', 'zh-TW': 'zh-Hant', 'ko-KR': 'ko' };
export const LINGO_LABELS = {
  'en-US': 'English', 'ja-JP': '日本語', 'zh-TW': '繁體中文', 'ko-KR': '한국어',
};
// 🩸 2026-08-06. This matched the DATA code only, and every consumer of it was being handed
// `meta.lang` — which sites write as a BCP-47 tag, because it is what goes in <html lang>. A site
// declares `lang: zh-Hant`; _canon returned null; every locale-keyed default fell through to
// en-US. Caught by building that site's preview before its own next build did: its sidebar read
// "All posts / Recent posts / Tags" and its date badges "Nov" where live says 所有貼文 and 11月.
// A Taiwanese site would have quietly become an English one, and nothing on the reference site
// could ever have shown it — that site writes the data code, so N was 1 and the wall was
// untested, not passed.
//
// So: accept every form a site actually writes. Data code (zh-TW), URL form (zh-tw), the BCP-47
// tag this project itself emits (zh-Hant), and the bare subtag (zh) — resolved in that order,
// most specific first, because `zh` alone must not outrank an explicit zh-Hant.
const _BCP47_TO_DATA = Object.fromEntries(Object.entries(LINGO_BCP47).map(([d, b]) => [b.toLowerCase(), d]));
const _SUBTAG_TO_DATA = Object.fromEntries(LINGO_LOCALES.map((l) => [l.split('-')[0].toLowerCase(), l]));
const _canon = (raw) => {
  const lc = String(raw || '').trim().toLowerCase();
  if (!lc) return null;
  const exact = LINGO_LOCALES.find((l) => l.toLowerCase() === lc);
  if (exact) return exact;
  if (_BCP47_TO_DATA[lc]) return _BCP47_TO_DATA[lc];
  // zh-Hant-TW / en-GB / ja-JP-u-ca-japanese — take the longest prefix that resolves.
  const parts = lc.split('-');
  for (let n = parts.length - 1; n >= 1; n--) {
    const head = parts.slice(0, n).join('-');
    if (_BCP47_TO_DATA[head]) return _BCP47_TO_DATA[head];
    const hit = LINGO_LOCALES.find((l) => l.toLowerCase() === head);
    if (hit) return hit;
  }
  return _SUBTAG_TO_DATA[parts[0]] || null;
};
/** mixed-case data code → lowercase URL form (zh-TW → zh-tw). */
export function toUrlLocale(locale) { return String(locale).toLowerCase(); }
/** any locale-ish string → BCP-47 attr tag (zh-TW / zh-tw → zh-Hant); unknown passes through. */
export function toBcp47(code) { const f = _canon(code); return f ? LINGO_BCP47[f] : String(code); }
/** human label for the locale picker. */
export function label(locale) { const f = _canon(locale); return f ? LINGO_LABELS[f] : String(locale); }

/** navigator.language prefixes that map to each locale (for the suggestion banner). */
const LINGO_PREFIXES = { 'en-US': ['en'], 'ja-JP': ['ja'], 'zh-TW': ['zh'], 'ko-KR': ['ko'] };
export function prefixes(locale) { const f = _canon(locale); return f ? LINGO_PREFIXES[f] : []; }

/** Per-locale suggestion-banner copy — each option speaks ITS OWN language (Signet pattern). */
const LINGO_BANNER = {
  'en-US': { prompt: 'Easier to read in English?', continue: 'Okay', dismiss: 'This is fine' },
  'zh-TW': { prompt: '改用台灣華語讀也許更順？', continue: '好啊', dismiss: '先不用沒關係' },
  'ja-JP': { prompt: '日本語の方が読みやすいかも？', continue: 'いいね', dismiss: '大丈夫です' },
  'ko-KR': { prompt: '영어 웹사이트가 더 편하신가요?', continue: '네', dismiss: '괜찮습니다' },
};
export function bannerCopy(locale) { const f = _canon(locale); return f ? LINGO_BANNER[f] : { prompt: '', continue: '', dismiss: '' }; }

/** Copy for the `/language` chooser page — each locale in ITS OWN language:
 *  word = the page title / heading; prompt = the lead sentence; current/switch = the per-row action. */
const LINGO_LANGUAGE = {
  'en-US': { word: 'Language', prompt: 'Pick the language you would like to use on this site.', current: 'Current', switch: 'Switch' },
  'zh-TW': { word: '語言', prompt: '請選擇你想在此網站使用的語言。', current: '目前', switch: '切換' },
  'ja-JP': { word: '言語', prompt: 'このサイトで使う言語を選んでください。', current: '現在', switch: '切り替え' },
  'ko-KR': { word: '언어', prompt: '이 사이트에서 사용하고 싶은 언어를 선택해 주세요.', current: '현재', switch: '변경' },
};
export function languageCopy(locale) { const f = _canon(locale); return f ? LINGO_LANGUAGE[f] : LINGO_LANGUAGE['en-US']; }

/** Which locales genuinely have THIS page — the input to hreflang.
 *
 *  An hreflang that points at a 404 is worse than no hreflang at all: search engines discard the
 *  whole reciprocal cluster rather than the one bad link. Until 2026-08-06 the layout advertised
 *  every configured locale for every page, which is true for content pages (authored per locale)
 *  and false for everything the build GENERATES — a blog index, its posts, tag/category/author/date
 *  archives, search. Measured on a live site: /devlog, 79 posts, /search and 62 tag pages each
 *  advertised ja/ko/zh-Hant, all 404 — about 429 dead declarations on a 244-page site, while /oss
 *  (a real four-locale content page) was correct. So the defect was never i18n; it was asserting
 *  existence without checking it.
 *
 *  Existence IS checkable: a content page lives at content/<sub>.md for the default locale and
 *  content/<urlLocale>/<sub>.md for the others. Generated routes have no content file in ANY
 *  locale, so they fall out to [] — which is the right answer, not a special case.
 *
 *  `all: true` is the one honest override, for a route that fans out per locale WITHOUT a content
 *  file behind it (pages/[...loc]/language.astro). It is opt-IN so that forgetting it costs a
 *  missing alternate, never a dead one.
 */
export function alternateLocales({ locales = [], defaultLocale = '', subPath = '', contentRels = null, all = false } = {}) {
  const list = Array.isArray(locales) ? locales.filter(Boolean) : [];
  if (all) return [...list];
  const has = contentRels instanceof Set ? contentRels : new Set(contentRels || []);
  const base = String(subPath || '').replace(/^\/+|\/+$/g, '') || 'home';
  return list.filter((l) => {
    if (l === defaultLocale) return has.has(base);
    const loc = toUrlLocale(l);
    // 🩸 caught by site-parity on its first run, on a live `/<locale>/` home: a locale HOME is written as
    // content/<loc>/home.md and the build collapses it to content/<loc>.md, so looking only for
    // "<loc>/home" found nothing and every locale home lost its alternates — including its own.
    // The collapse was already handled in lib/sitemap.mjs. Knowing about it there and not here is
    // the same fix landing in one of two places, which is the defect this whole round is about.
    if (base === 'home') return has.has(`${loc}/home`) || has.has(loc);
    return has.has(`${loc}/${base}`);
  });
}

/** content/**\/*.md glob keys → the rel paths alternateLocales() matches against
 *  ("home", "about", "ja-jp/about", "legal/terms"). `_site`/`_theme` are site DATA, not pages —
 *  the router skips them, so this must too, or a config file would vouch for a locale. */
export function contentRelsOf(contentGlob) {
  const out = new Set();
  for (const path of Object.keys(contentGlob || {})) {
    if (/(^|\/)_(site|theme)\.md$/.test(path)) continue;
    const rel = String(path).split('/content/')[1];
    if (rel) out.add(rel.replace(/\.md$/, ''));
  }
  return out;
}

/** Chrome copy for the blog sidebar + archive widgets — the strings a visitor reads that nobody
 *  authored.
 *
 *  🩸 2026-08-06. These were hardcoded Chinese, inline, in THREE components (BlogIndexView,
 *  PostView, ArchiveView) plus DateArchiveView's heading, and only the search placeholder had an
 *  override key. So a Japanese, Korean or English tenant that turned the sidebar on got 最新文章 /
 *  標籤雲 / 所有貼文 and counts wrapped in full-width parentheses. Same family as the fallbacks that
 *  once served the vendor's blog title to every other site: a multi-tenant renderer treating one language
 *  as the default rather than as a choice.
 *
 *  Defaults are keyed by the site's own `lang`, so zh-TW renders byte-identically to before and the
 *  other locales stop borrowing its voice. Per-site overrides sit on top (see sidebarCopy).
 *
 *  The two archive prefixes live here for the same reason and one more: the CJK defaults end in a
 *  FULL-WIDTH colon, which carries its own visual gap, so nobody ever noticed that a Latin prefix
 *  needs a trailing space — and a trailing space is exactly what a site could not write, because
 *  splitFrontmatter trims every value. See unquote() in lib/blog.mjs.
 *
 *  `count` is a formatter, not a string, because the punctuation is part of the language: CJK wraps
 *  in full-width parentheses with no space, Latin uses a space and half-width ones. A template that
 *  hardcodes either is the same defect one layer down.
 */
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const LINGO_UI = {
  'en-US': { recent: 'Recent posts', tags: 'Tags', archive: 'All posts', search: 'Search…',
    tagPrefix: 'Posts tagged ', datePrefix: 'Posted in ',
    authorPrefix: 'Posts by ', categoryPrefix: 'Posts in ', pageSuffix: (n) => ` (page ${n})`,
    noMatches: 'No matching posts', clearFilter: '\u2715 Clear filter', monthShort: (n) => (EN_MONTHS[Number(n) - 1] || String(n)).slice(0, 3),
    ageBack: 'Go back', ageConfirm: 'Yes',
    notFoundTitle: 'Page not found', notFoundBody: "That address doesn't exist on this site.", notFoundHome: 'Go to the homepage',
    month: (n) => EN_MONTHS[Number(n) - 1] || String(n), countWrap: [' (', ')'] },
  'zh-TW': { recent: '最新文章', tags: '標籤雲', archive: '所有貼文', search: '搜尋......',
    tagPrefix: '顯示具有以下標籤的文章：', datePrefix: '發表於：',
    authorPrefix: '作者：', categoryPrefix: '分類：', pageSuffix: (n) => `（第 ${n} 頁）`,
    noMatches: '沒有符合的文章', clearFilter: '\u2715 清除篩選', monthShort: (n) => `${Number(n)}月`,
    ageBack: '返回', ageConfirm: '是',
    notFoundTitle: '找不到頁面', notFoundBody: '這個網站上沒有這個網址。', notFoundHome: '回到首頁',
    month: (n) => `${Number(n)}月`, countWrap: ['（', '）'] },
  'ja-JP': { recent: '最新の記事', tags: 'タグクラウド', archive: 'すべての記事', search: '検索......',
    tagPrefix: 'タグ：', datePrefix: '投稿日：',
    authorPrefix: '投稿者：', categoryPrefix: 'カテゴリー：', pageSuffix: (n) => `（${n}ページ目）`,
    noMatches: '一致する記事はありません', clearFilter: '\u2715 絞り込みを解除', monthShort: (n) => `${Number(n)}月`,
    ageBack: '戻る', ageConfirm: 'はい',
    notFoundTitle: 'ページが見つかりません', notFoundBody: 'このサイトにそのアドレスはありません。', notFoundHome: 'ホームへ',
    month: (n) => `${Number(n)}月`, countWrap: ['（', '）'] },
  'ko-KR': { recent: '최근 글', tags: '태그 클라우드', archive: '모든 글', search: '검색...',
    tagPrefix: '태그: ', datePrefix: '게시일: ',
    authorPrefix: '작성자: ', categoryPrefix: '카테고리: ', pageSuffix: (n) => ` (${n}페이지)`,
    noMatches: '일치하는 글이 없습니다', clearFilter: '\u2715 필터 해제', monthShort: (n) => `${Number(n)}월`,
    ageBack: '돌아가기', ageConfirm: '예',
    notFoundTitle: '페이지를 찾을 수 없습니다', notFoundBody: '이 사이트에 해당 주소가 없습니다.', notFoundHome: '홈으로',
    month: (n) => `${Number(n)}월`, countWrap: [' (', ')'] },
};
/**
 * The language a page declares when its site does not say.
 *
 * 🩸 measured on a live site: `/` said zh-Hant and `/blog/`, every post and the 404 all
 * said en-US — one site, one build, two languages, because SiteLayout and PageView defaulted to
 * 'zh-Hant' while BlogIndexView, ArchiveView, PostView, search, preview and 404.astro defaulted to
 * 'en-US'. Nobody chose that; it is nine copies of a literal that drifted apart. A screen reader
 * switches voice halfway through the site and a search engine files the blog as English.
 *
 * It surfaced as "the 404 page is in English", which is the one page a visitor happens to notice —
 * and reads like a translation gap. It is not: Lingo renders that page perfectly. It
 * was a fallback disagreeing with a fallback.
 *
 * So: ONE default, named, imported. Aligned to the shell's value, which already governs the home
 * page, so no site changes what it says on the page people actually land on.
 */
export const DEFAULT_LANG = 'zh-Hant';

/**
 * The UI copy a site gets when it declares no language — deliberately NOT DEFAULT_LANG.
 *
 * 🩸 2026-08-08. Sweeping nine `|| 'en-US'` literals into one constant, I took this one with them
 * and chrome-copy.test.mjs went red on a line that says exactly why: "no lang → the neutral
 * default, never Chinese". A site that declared nothing must not silently be handed Chinese date
 * badges and sidebar labels; that was decided, tested, and I read it as drift.
 *
 * These answer different questions. `<html lang>` says what language this DOCUMENT is, and must be
 * ONE answer per site or a screen reader changes voice mid-visit. This says which strings to use
 * when nobody has told us — and English is the neutral one. Same literal before, two names now, so
 * the next sweep can tell a decision from a leftover.
 */
export const NEUTRAL_UI_LANG = 'en-US';

export function uiCopy(locale) {
  const f = _canon(locale);
  const row = (f && LINGO_UI[f]) || LINGO_UI['en-US'];
  // `count` is DERIVED from countWrap rather than written out per row, because the client-side
  // archive island is handed the PAIR (it cannot receive a function). Two hand-written formatters
  // would be the same string in two places with nothing checking they agree — the defect this whole
  // table exists to end.
  const [open, close] = row.countWrap;
  return { ...row, count: (label, n) => `${label}${open}${n}${close}` };
}

/** The date-archive heading ("July 2026" / "2026 年 7 月"), same reasoning as uiCopy: the ORDER of
 *  year and month is a language fact, not a format string somebody can share between locales. */
export function dateHeading(locale, year, month) {
  const f = _canon(locale);
  const y = String(year);
  if (!month) return f === 'en-US' || !f ? y : `${y} 年`;
  const n = Number(month);
  if (f === 'zh-TW') return `${y} 年 ${n} 月`;
  if (f === 'ja-JP') return `${y}年${n}月`;
  if (f === 'ko-KR') return `${y}년 ${n}월`;
  return `${EN_MONTHS[n - 1] || n} ${y}`;
}
