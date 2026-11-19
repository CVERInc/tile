// The locale TABLE on its own: which editions a site can have, and the BCP-47 tag each one is
// written as in <html lang> and hreflang. locale.mjs reads its table from here; so does anything
// that has to be bundled for a browser and only needs the table.
//
// 🔴 A LEAF. No imports, no copy, no work at the top level — only constants and functions. A coral
// bundle (dynamic-corals/countdown) imports this to read a page's tag back to its locale; importing
// locale.mjs instead carried every locale's banner, chooser and inbox copy into that bundle, because
// a bundler cannot prove that module's top level free of effects and keeps all of it.
//
// Lives at the top level of packages/sitetile next to locale.mjs, which imports it from its own
// directory (the reef vendor closure copies site-core's siblings).

/** The Lingo editions, as DATA codes (canonical mixed case). Simplified Chinese is an edition too,
 *  but is not in this list — see SIMPLIFIED. */
export const LINGO_LOCALES = ['en-US', 'ja-JP', 'zh-TW', 'ko-KR'];
/** Simplified Chinese: its own edition (identity zh-CN, tag zh-Hans), resolved separately in
 *  locale.mjs so that bare `zh` keeps meaning zh-TW. */
export const SIMPLIFIED = 'zh-CN';
/** Every edition → its BCP-47 attr tag. Standards-correct: zh-Hant / zh-Hans, never zh-TW. */
export const EDITION_TAGS = { 'en-US': 'en', 'ja-JP': 'ja', 'zh-TW': 'zh-Hant', 'ko-KR': 'ko', 'zh-CN': 'zh-Hans' };

/** BCP-47 attr tag → the URL form of the edition it is the tag OF (zh-Hant → zh-tw, zh-Hans → zh-cn,
 *  en → en-us): the table read backwards. Exact, never a guess — a tag no edition is written as
 *  (zh-HK, zh-Hant-TW, en-GB, de) gives ''. For a reader handed `<html lang>` that has to find what an
 *  author keyed by the site's own spelling of the locale. */
export function urlLocaleOfTag(tag) {
  const lc = String(tag || '').trim().toLowerCase();
  if (!lc) return '';
  for (const edition in EDITION_TAGS) if (EDITION_TAGS[edition].toLowerCase() === lc) return edition.toLowerCase();
  return '';
}
