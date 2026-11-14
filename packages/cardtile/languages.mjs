// A Card in several languages: one file per language (tile#304). Pure, node-testable, no store.
//
// The main file IS the Card. Its frontmatter lists the languages there are (`locales: [en-US, ja-JP]`),
// and each listed language other than the main file's own may have a file of its own beside it. This
// module holds every rule about those files that is not storage or HTTP: what a language tag is, which
// listed language a visitor gets, which frontmatter keys a language file may carry, and how a language
// file is put together with the main file to make the page that is served.
//
// 🔴 ONE FILE PER LANGUAGE, NEVER SEVERAL LANGUAGES INSIDE ONE FILE, AND NEVER A LOCALE IN THE PATH.
// A Card has one address. The language is chosen by `?lang=` or by the visitor's Accept-Language, and a
// choice that cannot be honoured is the main file — never a 404 because of language.
//
// 🔴 A LANGUAGE FILE NEVER CHANGES WHAT THE CARD IS. It is a complete card file in the same grammar and
// is rendered as it is when chosen; keeping its tiles in step with the main file's is the writer's job
// (an agent or an editor), and the engine does not compare structures. But everything the frontmatter
// decides for the WHOLE Card (its look, its views, its default back, the claim, the language list) is
// read from the main file, always. A language file may carry only the per-language keys below; any
// other key is refused when the file is written and ignored when it is read.

import { parseCard, serializeCard } from './card-core.js';

/** the frontmatter key, in the MAIN file, that lists the Card's languages */
export const LOCALES_KEY = 'locales';

/**
 * An engine safety limit, not a product limit: `locales:` lists at most this many tags (the main file's
 * own language included), so a Card has at most this many language files. Each file obeys the per-card
 * byte ceiling on its own (CARD_MAX_BYTES); there is no separate total.
 */
export const MAX_LOCALES = 12;

/**
 * The frontmatter keys a language file may carry. These are the owner's words about the Card that are
 * not tiles: its name, and the file's own language. Everything else in a frontmatter fence is decided
 * for the whole Card by the main file — see WHOLE_CARD_KEYS and the table in GRAMMAR.md.
 *   title  per language: the Card's name in that language. Absent: the main file's title.
 *   lang   per language: must be the tag the file is stored under. Absent: that tag.
 */
export const PER_LANGUAGE_KEYS = Object.freeze(['title', 'lang']);

/**
 * Every OTHER frontmatter key the engine, the deck or the editor reads, each decided by the main file for
 * the whole Card (ai-ops-card.test.mjs holds this list equal to CARD_SETTINGS plus the claim and
 * `locales:`). A key that is in neither list is not read by anything in this repository; a language file
 * may not carry it either, because a repository that vendors the engine may read it for the whole Card.
 */
export const WHOLE_CARD_KEYS = Object.freeze([
  // the look: one Card looks one way in every language
  'accent', 'theme', 'header', 'icons', 'backdrop', 'backdrop-dim', 'arrows', 'radius',
  // the structure a visitor navigates (w3/deck-page.mjs DECK_KEYS)
  'views', 'view', 'back',
  // the footer and the page's own metadata: the same Card, the same year, the same opt-ins
  'since', 'generator', 'powered-by',
  // identity: which handle this file is (claim.mjs reads either spelling), and which languages exist
  'cardtile', 'card-page', LOCALES_KEY,
]);

// ── language tags ────────────────────────────────────────────────────────────────────────────────

/** the syntax the renderer accepts for `<html lang>` (card-render.mjs), here as the whole rule */
const TAG_SHAPE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
/** RFC 5646 §4.4.1 asks implementations to support at least 35 characters; nothing longer is a tag here */
const TAG_MAX = 35;

/**
 * normaliseTag: a tag as written → its canonical spelling, or null when it is not one this engine takes.
 *   · `_` is read as `-` (a query string is typed by people);
 *   · the shape is the renderer's own (letters, then 2–8 letter/digit subtags): so no wildcard, no
 *     extension or private-use singleton (`-u-`, `-x-`), nothing over 35 characters;
 *   · case is RFC 5646's convention: language lower, a 4-letter script Title, a 2-letter region upper,
 *     anything else lower. `ZH-hant-tw` → `zh-Hant-TW`.
 * Nothing is aliased: `zh-TW` and `zh-Hant-TW` are two tags (matchTag decides how near they are).
 */
export function normaliseTag(tag) {
  if (typeof tag !== 'string') return null;
  const t = tag.trim().replace(/_/g, '-');
  if (!t || t.length > TAG_MAX || !TAG_SHAPE.test(t)) return null;
  return t.split('-').map((s, i) => {
    if (i === 0) return s.toLowerCase();
    if (/^[A-Za-z]{4}$/.test(s)) return s[0].toUpperCase() + s.slice(1).toLowerCase();
    if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
    return s.toLowerCase();
  }).join('-');
}

const primaryOf = (tag) => tag.split('-')[0];
/**
 * the script a tag names or (for Chinese only) implies by its region, or null when it says nothing.
 * Chinese is the one language here whose written form splits by script in a way readers care about;
 * a reader of `zh-CN` is not served `zh-TW` merely because both say `zh`.
 */
const HANT_REGIONS = new Set(['TW', 'HK', 'MO']);
const HANS_REGIONS = new Set(['CN', 'SG', 'MY']);
function scriptOf(tag) {
  const parts = tag.split('-');
  const script = parts.slice(1).find((s) => /^[A-Z][a-z]{3}$/.test(s));
  if (script) return script;
  if (parts[0] !== 'zh') return null;
  const region = parts.slice(1).find((s) => /^[A-Z]{2}$/.test(s));
  if (region && HANT_REGIONS.has(region)) return 'Hant';
  if (region && HANS_REGIONS.has(region)) return 'Hans';
  return null;
}

/**
 * matchTag: (a requested tag, the candidates in order) → the candidate it is served, or null.
 * The request is normalised first; a malformed one matches nothing. Then, in order:
 *   1. exact                      `ja-JP` → `ja-JP`
 *   2. lookup (RFC 4647 §3.4)     drop the last subtag until something matches: `zh-Hant-TW` → `zh-Hant` → `zh`
 *   3. same language              the first candidate with the request's primary language, unless both
 *                                 name (or, for Chinese, imply) a script and the scripts differ:
 *                                 `en-GB` → `en-US`; `zh-CN` never → `zh-TW`
 * Candidates are compared in their normalised spelling.
 */
export function matchTag(requested, candidates) {
  const want = normaliseTag(requested);
  if (!want) return null;
  const list = (candidates || []).map(normaliseTag).filter(Boolean);
  if (list.includes(want)) return want;
  const parts = want.split('-');
  for (let n = parts.length - 1; n >= 1; n--) {
    const shorter = parts.slice(0, n).join('-');
    if (list.includes(shorter)) return shorter;
  }
  const lang = primaryOf(want), script = scriptOf(want);
  for (const c of list) {
    if (primaryOf(c) !== lang) continue;
    const s = scriptOf(c);
    if (script && s && s !== script) continue;
    return c;
  }
  return null;
}

// ── the frontmatter fence ────────────────────────────────────────────────────────────────────────

const FENCE = /^---\n([\s\S]*?)\n---(?:\n|$)/;
const LINE_KEY = /^([\w-]+):\s*(.*)$/;

/** the fence's lines and the text after it, or no fence */
function splitFence(md) {
  const text = String(md ?? '').replace(/\r\n/g, '\n');
  const f = FENCE.exec(text);
  if (!f) return { lines: null, rest: text };
  return { lines: f[1].split('\n'), rest: text.slice(f[0].length) };
}

/** the value of `key` in the fence (matched outer quotes removed), or '' */
function fenceValue(lines, key) {
  for (const l of lines || []) {
    const m = LINE_KEY.exec(l);
    if (m && m[1] === key) { const v = m[2].trim(); return /^(['"]).*\1$/.test(v) ? v.slice(1, -1).trim() : v; }
  }
  return '';
}

/** the keys written in a file's frontmatter fence, in order */
export function fenceKeys(md) {
  return (splitFence(md).lines || []).map((l) => LINE_KEY.exec(l)).filter(Boolean).map((m) => m[1]);
}

/**
 * readLocales: the main file → `{ tags, invalid, raw }`. `tags` are the listed languages, normalised,
 * deduplicated, in the order written; `invalid` the entries that are not tags; `raw` whether the line is
 * there at all. The value is a YAML flow list or a plain list: `[en-US, ja-JP]`, `en-US ja-JP`,
 * `en-US, ja-JP` (quotes around an entry are allowed).
 */
export function readLocales(md) {
  const { lines } = splitFence(md);
  const present = (lines || []).some((l) => (LINE_KEY.exec(l) || [])[1] === LOCALES_KEY);
  if (!present) return { tags: [], invalid: [], raw: false };
  const v = fenceValue(lines, LOCALES_KEY).replace(/^\[|\]$/g, '');
  const tags = [], invalid = [];
  for (const entry of v.split(/[\s,]+/).map((e) => e.replace(/^(['"])(.*)\1$/, '$2')).filter(Boolean)) {
    const t = normaliseTag(entry);
    if (!t) invalid.push(entry);
    else if (!tags.includes(t)) tags.push(t);
  }
  return { tags, invalid, raw: true };
}

/** the main file's own language (`lang:`), normalised, or null */
export const mainLangOf = (md) => normaliseTag(fenceValue(splitFence(md).lines, 'lang'));

/**
 * languagesOf: the main file → what the engine reads about its languages.
 *   listed    the tags in `locales:` (the cap applied: entries past MAX_LOCALES are not candidates)
 *   main      the main file's own `lang:`, or null
 *   files     the listed tags that may have a file: every listed tag except the main file's own
 * A Card with no `locales:` line answers `{ listed: [], main, files: [] }`, and nothing about it changes.
 */
export function languagesOf(md) {
  const listed = readLocales(md).tags.slice(0, MAX_LOCALES);
  const main = mainLangOf(md);
  return { listed, main, files: listed.filter((t) => t !== main) };
}

/**
 * localesRefusal: a main file about to be saved → null, or the refusal its `locales:` line earns.
 *   cards_locales_invalid    an entry is not a language tag (`entries` names them)
 *   cards_locales_too_many   more than MAX_LOCALES distinct tags
 * A main file without `locales:` is never refused here.
 */
export function localesRefusal(md) {
  const { tags, invalid, raw } = readLocales(md);
  if (!raw) return null;
  if (invalid.length) {
    return { error: 'cards_locales_invalid', entries: invalid,
      why: `\`locales:\` lists ${invalid.map((e) => JSON.stringify(e)).join(', ')}, which ${invalid.length === 1 ? 'is not a language tag' : 'are not language tags'} (such as en-US or ja-JP). Nothing was saved.` };
  }
  if (tags.length > MAX_LOCALES) {
    return { error: 'cards_locales_too_many', limit: MAX_LOCALES, count: tags.length,
      why: `\`locales:\` lists ${tags.length} languages; a Card can list at most ${MAX_LOCALES}. Nothing was saved.` };
  }
  return null;
}

// ── a language file ──────────────────────────────────────────────────────────────────────────────

/**
 * languageFileRefusal: (the language file as sent, its tag) → null, or why it cannot be stored.
 *   cards_language_key_refused     its frontmatter carries a key other than title/lang (`key` names the
 *                                  first, `keys` all of them): that key is the main file's to decide
 *   cards_language_lang_mismatch   its `lang:` is not the tag it is being stored under
 * The tag is assumed normalised (the route normalises it).
 */
export function languageFileRefusal(md, tag) {
  const { lines } = splitFence(md);
  const keys = (lines || []).map((l) => LINE_KEY.exec(l)).filter(Boolean).map((m) => m[1]);
  const refused = [...new Set(keys.filter((k) => !PER_LANGUAGE_KEYS.includes(k)))];
  if (refused.length) {
    return { error: 'cards_language_key_refused', key: refused[0], keys: refused,
      why: `A language file may set only ${PER_LANGUAGE_KEYS.map((k) => `\`${k}\``).join(' and ')} in its frontmatter; \`${refused[0]}\` is decided for the whole Card by the main file. Remove ${refused.length === 1 ? 'that line' : 'those lines'} and save again. Nothing was saved.` };
  }
  const lang = fenceValue(lines, 'lang');
  if (lang && normaliseTag(lang) !== tag) {
    return { error: 'cards_language_lang_mismatch', lang, tag,
      why: `This file says \`lang: ${lang}\` but is being saved as ${tag}. Make them the same, or remove the \`lang:\` line. Nothing was saved.` };
  }
  return null;
}

/** the language file as it is stored: the caller's file with any assets lane dropped (assets are the main file's) */
export const storedLanguageFile = (md) => serializeCard({ ...parseCard(String(md ?? '')), assets: {} });

/**
 * composeLanguage: (main file, language file, tag) → the card file that is served for that language.
 *   frontmatter  the main file's fence, its `title:` replaced by the language file's (when it has one) and
 *                its `lang:` set to the tag; every other main key stays, and nothing else of the language
 *                file's fence is read (a key it should not carry is IGNORED here, refused on write)
 *   lanes        the language file's: its tiles, sections and backs, as written
 *   assets       the main file's: one assets lane for every language, so `asset:<id>` means the same
 *                picture in every file
 * The result is an ordinary card file: every renderer and exit takes it as they take a main file.
 */
export function composeLanguage(mainMd, langMd, tag) {
  const main = splitFence(mainMd), lang = splitFence(langMd);
  const title = fenceValue(lang.lines, 'title');
  const kept = (main.lines || []).filter((l) => {
    const k = (LINE_KEY.exec(l) || [])[1];
    return k !== 'lang' && !(k === 'title' && title);
  });
  const fence = [...kept, ...(title ? [`title: ${title}`] : []), `lang: ${tag}`];
  const model = parseCard(`---\n${fence.join('\n')}\n---\n${lang.rest}`);
  return serializeCard({ ...model, assets: parseCard(String(mainMd ?? '')).assets });
}

// ── which file a visitor gets ────────────────────────────────────────────────────────────────────

/**
 * chooseLanguage: the main file + what the request says → `{ tag, matched, by }`: the listed language
 * whose FILE to serve (null = the main file), the candidate the request matched (the main file's own
 * language included; null = none), and what chose it ('query' | 'header' | null).
 *
 *   candidates   the listed tags, plus the main file's own `lang:` (which is the main file)
 *   `?lang=`     first. A well-formed value DECIDES: matched → that language, otherwise the main file,
 *                and the header is not asked (the visitor said which). An empty or malformed value is
 *                not a request for a language, and is ignored.
 *   Accept-Language  then, with q-weights, through `pickRange` (sandbox-i18n's walker): highest q wins,
 *                ties keep header order, q=0 excludes, `*` matches nothing.
 * `tag` is null whenever the answer is the main file: no candidate matched, or the match IS the main
 * file's own language. Whether the chosen language has a file is the caller's question (a missing file
 * is also the main file).
 */
export function chooseLanguage(mainMd, { query = null, acceptLanguage = null } = {}, pickRange) {
  const { listed, main } = languagesOf(mainMd);
  if (!listed.length) return { tag: null, matched: null, by: null };
  const candidates = main && !listed.includes(main) ? [...listed, main] : listed;
  const answer = (matched, by) => ({ tag: matched && matched !== main ? matched : null, matched, by });
  if (query != null && normaliseTag(query)) return answer(matchTag(query, candidates), 'query');
  const picked = typeof pickRange === 'function' ? pickRange(acceptLanguage, (t) => matchTag(t, candidates)) : null;
  return picked ? answer(picked, 'header') : answer(null, null);
}
