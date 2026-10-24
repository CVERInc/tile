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

/** A frontmatter list (`a, b , c`) or an array → trimmed, non-empty entries. */
const _list = (v) => (Array.isArray(v) ? v : String(v || '').split(','))
  .map((s) => String(s).trim()).filter(Boolean);

/** `locales:` as a site writes it → the site's locale list. THE one parser: every reader of
 *  `locales` (layout, chooser route, blog, sitemap, verdict, inbox bubble) calls this, because each
 *  entry becomes a URL path segment (`/<lowercased>/`) and a directory in the build.
 *
 *  🩸 CVERInc/reef#1910. There were eleven copies of `split(',').map(trim).filter(Boolean)`, and the
 *  frontmatter reader is deliberately not YAML — it hands the value over verbatim. So
 *  `locales: [zh-TW, en-US]` built a directory named `en-us]`, `"zh-TW, en-US"` one named `en-us"`,
 *  and `ko/kr` a nested `ko/kr/language/`; `../kiln` failed the build on a routing error that never
 *  mentioned the line that caused it.
 *
 *  Three rules, in this order:
 *    1. list punctuation around an entry (`[ ] " '`) is dropped — the three spellings above are
 *       unambiguous, and an empty entry (a trailing comma) is skipped as it always was;
 *    2. what is left must be letters, digits and single hyphens — anything else THROWS a
 *       LocaleListError naming the entry, rather than becoming a path;
 *    3. an entry whose URL form is already listed (`zh-TW, zh-tw`, or the same code twice) is one
 *       directory written twice — the first spelling is kept.
 *
 *  What an author types without seeing it is not a mistake to fail a build over:
 *    • `，` (U+FF0C) and `、` (U+3001) separate entries exactly like `,` — they are what a Chinese
 *      or Japanese keyboard produces for a comma, and neither can be part of a code;
 *    • whitespace of every kind (no-break and ideographic space included) and invisible format
 *      characters (zero-width space, BOM, joiners, direction marks) AROUND an entry are dropped
 *      with the list punctuation. INSIDE an entry they are still refused: `zh<U+200B>-TW` is not
 *      a spelling of zh-TW anybody meant to write.
 *  Still refused, with a hint: `zh_TW` (the message offers `zh-TW`), and a trailing `# comment` —
 *  this frontmatter has no comments for any key, so stripping one here alone would teach a rule
 *  that is false on the next line.
 *
 *  `source` is the file the value was written in (`content/_site.md`, `content/about.md`), for the
 *  error message — see localesSourceOf. */
const _LOCALE_CODE = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const _LOCALE_SEPARATORS = /[,，、]/;
const _LOCALE_PADDING = /^[\s\p{Cf}\["']+|[\s\p{Cf}\]"']+$/gu;
/** An entry as the message shows it: quoted, with every character that is not printable ASCII
 *  written as `\u{…}` — the character that broke the build is often one nobody can see. */
const _visible = (s) => `"${[...String(s)].map((ch) => {
  const cp = ch.codePointAt(0);
  if (ch === '\\' || ch === '"') return `\\${ch}`;
  return cp >= 0x20 && cp <= 0x7e ? ch : `\\u{${cp.toString(16).toUpperCase().padStart(4, '0')}}`;
}).join('')}"`;
const _localeHint = (entry) => {
  if (entry.includes('#')) return ' This frontmatter has no comments: remove the `#` and what follows it.';
  const hyphenated = entry.replace(/_/g, '-');
  if (hyphenated !== entry && _LOCALE_CODE.test(hyphenated)) return ` Did you mean ${_visible(hyphenated)}?`;
  return '';
};
export class LocaleListError extends Error {
  constructor(entry, source = '') {
    super(`sitetile: locales entry ${_visible(entry)} is not a locale code — a code is letters, `
      + `digits and hyphens only (en-US, zh-TW), because each one becomes a URL path segment.${_localeHint(entry)} `
      + (source ? `Fix the \`locales:\` line in ${source}.`
        : 'Fix the `locales:` line where it is written (the site config, or the page\'s own frontmatter).'));
    this.name = 'LocaleListError';
    this.entry = entry;
    this.source = source;
  }
}
export function parseLocales(v, source = '') {
  const out = [];
  for (const item of (Array.isArray(v) ? v : String(v ?? '').split(_LOCALE_SEPARATORS))) {
    const s = String(item ?? '').replace(_LOCALE_PADDING, '');
    if (!s) continue;
    if (!_LOCALE_CODE.test(s)) throw new LocaleListError(s, source);
    if (!out.some((seen) => seen.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out;
}

/** Which file a meta object's `locales` was written in — carried ON the object, because by the time
 *  anything parses it the object is `{ ...siteConfig, ...pageFrontmatter }` and the value alone no
 *  longer says whose it is.
 *
 *  🩸 CVERInc/reef#1910. A page may write its own `locales:`, and it reaches the same parser. The
 *  error said "fix the site config" for a line that was in `content/about.md`.
 *
 *  A symbol key, so it is no frontmatter key (nothing lists, renders or serialises it) and an
 *  object spread carries it exactly as it carries `locales` itself: the later object's wins, and
 *  an object that has no `locales` of its own has no tag to overwrite the earlier one with. */
const _LOCALES_SOURCE = Symbol('sitetile.localesSource');
export function tagLocalesSource(meta, file) {
  if (meta && Object.prototype.hasOwnProperty.call(meta, 'locales')) meta[_LOCALES_SOURCE] = String(file || '');
  return meta;
}
export function localesSourceOf(meta) { return (meta && meta[_LOCALES_SOURCE]) || ''; }

/** A PAGE's own frontmatter, before it is merged over the site config: tag its `locales` with the
 *  page's file — or, when that value is not a locale list, WARN and drop it, so the page reads the
 *  site's list as if it had written none. Returns the warning (or null), for tests.
 *
 *  An illegal `locales` in the SITE layer fails the build (parseLocales throws); the same value on
 *  one page does not. A page's `locales` only ever steers that page's own head and footer links —
 *  one odd line in one page is not a reason to take the whole site's build down, and dropped here
 *  it never reaches anything that makes a path of it. `site` is the site-config meta the page
 *  merges over (or null), only to say what the page falls back to.
 *
 *  Once per file: the chooser route reads the home pages too, and a log that says a thing twice
 *  reads as two problems. */
const _warnedPageLocales = new Set();
export function pageLocalesOrWarn(meta, file, site = null) {
  if (!meta || !Object.prototype.hasOwnProperty.call(meta, 'locales')) return null;
  try {
    parseLocales(meta.locales, file);
    tagLocalesSource(meta, file);
    return null;
  } catch (e) {
    if (!(e instanceof LocaleListError)) throw e;
    delete meta.locales;
    const siteFile = localesSourceOf(site);
    const msg = `sitetile: locales entry ${_visible(e.entry)} in ${file} is not a locale code — a code is `
      + `letters, digits and hyphens only (en-US, zh-TW).${_localeHint(e.entry)} This page's own \`locales:\` line is IGNORED: `
      + (siteFile ? `the page uses the site's list from ${siteFile}.` : 'the page is treated as declaring none.');
    if (!_warnedPageLocales.has(file)) { _warnedPageLocales.add(file); console.warn(msg); }
    return msg;
  }
}

/** The site's DEFAULT locale — the one that lives at `/`. THE one definition:
 *  the first entry of `locales`, else `fallback` (the language of a site that declares none).
 *
 *  🩸 CVERInc/reef#1910. Nine places derived this inline and they did not all agree on the first
 *  preference: the layout, the chooser, the blog link helpers and the verdict took `locales[0]`;
 *  the 404's language took the site config's own `lang:` first. On a site where the two differ the
 *  404 was rendered as a non-default-locale page of a site whose every other route said otherwise.
 *  `locales[0]` is the rule the URLs already obey (it is what decides which locale is unprefixed),
 *  so it is the first preference everywhere; `fallback` is each caller's own second answer. */
export function defaultLocaleOf(locales, fallback = '') {
  return parseLocales(locales)[0] || String(fallback || '').trim();
}

/** The sentence for a site whose ROOT home page says one language while `locales` puts another
 *  first — or null when they agree (or either is silent). `locales[0]` wins; this only says so.
 *
 *  🩸 CVERInc/reef#1910. "The first locale lives at `/`" was a rule nothing stated and nothing
 *  checked: `locales: en-US, zh-TW` over a Chinese home page built `<html lang="zh-Hant">` at `/`
 *  with `hreflang="en" href="/"` beside it, and a chooser whose Chinese row went to a `/zh-tw/`
 *  nobody had written. The build was green and silent. */
export function rootLangMismatch({ locales = [], rootLang = '' } = {}) {
  const first = parseLocales(locales)[0];
  const lang = String(rootLang || '').trim();
  if (!first || !lang || sameLocale(first, lang)) return null;
  return `sitetile: the home page says lang: ${lang}, but locales lists ${first} first — and the `
    + `first locale is the one served at "/". ${first} wins: hreflang, x-default and the language `
    + `chooser all treat "/" as ${first}, and ${lang} is expected under /${toUrlLocale(localeOf(locales, lang))}/. `
    + `Put the home page's language first in locales, or move that page under its own locale.`;
}

/** Is the Lingo install on for this site? — the ONE definition; every gate calls this.
 *
 *  🩸 2026-10-11. This was `packages.includes('lingo')`, copied into SiteLayout and the /language
 *  route, while the platform's own docs told owners "the second language is free, no Lingo module
 *  needed" and nothing on the platform ever wrote `packages: lingo`. A site that declared
 *  `locales: en, zh-TW` exactly as told got the un-installed path: hreflang to /en/ and /zh-TW/
 *  (both 404), no footer Language link, no /language page — worse than staying monolingual.
 *
 *  Owner ruling 2026-10-10: the switch is the owner DECLARING a second language — `locales` with
 *  two or more entries. Free, but never forced on a one-language site. `packages: lingo` is still
 *  honoured (sites that already carry it keep working) but is no longer required. */
export function lingoEnabled({ packages = [], locales = [] } = {}) {
  return _list(packages).includes('lingo') || _distinct(parseLocales(locales)).length > 1;
}

/** Do two locale spellings name the same locale? `en` / `en-US` / `en-us` all do; so do `zh-Hant`
 *  and `zh-TW`. Unknown codes fall back to a case-insensitive comparison.
 *
 *  🩸 2026-10-11. The /language route compared the root home's `lang:` to `locales[0]` with `===`,
 *  and SiteLayout compared `toUrlLocale(lang)` to the default's URL form — an unwritten rule that
 *  the two must be spelled identically. `locales: en-US` + `lang: en` (both correct) produced a
 *  chooser at /en-us/language and a footer link to /en/language, both 404. */
export function sameLocale(a, b) {
  const ca = _canon(a), cb = _canon(b);
  if (ca && cb) return ca === cb;
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/** A locale list with each LOCALE kept once — first spelling wins. `zh-TW, zh-TW` and
 *  `zh-TW, zh-tw` are one language written twice, not a second one; counting entries instead
 *  switched the install on for a one-language site and built it a chooser with two identical rows
 *  and a hreflang pointing at /zh-tw/zh-tw/. (A function declaration: lingoEnabled, above, calls
 *  it, and sameLocale is hoisted the same way.) */
function _distinct(list) {
  const out = [];
  for (const l of list) if (!out.some((seen) => sameLocale(seen, l))) out.push(l);
  return out;
}

/** The entry of `locales` that a page's `lang:` means (so `lang: zh-Hant` → `zh-TW`), or `lang`
 *  itself when none does. URL prefixes must be derived from THIS, never from the raw `lang:`. */
export function localeOf(locales, lang) {
  return parseLocales(locales).find((l) => sameLocale(l, lang)) || lang;
}

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

/** The banner's three sentences, overridden per locale from the SITE layer (CVERInc/reef#1888).
 *
 *  A site wanted a more formal register than the defaults and had no setting for it — the only
 *  way was per-page JS, which is the kind of patch that breaks on the next release. The override
 *  opens TEXT only (never style), as flat keys in the `locales` family, because every site-layer
 *  key is a flat scalar and `locales` itself is one:
 *    locales-banner-<locale>-prompt | locales-banner-<locale>-continue | locales-banner-<locale>-dismiss
 *  <locale> is spelled any way `locales` accepts (zh-TW, zh-tw, zh-Hant). The sentence is the one
 *  shown to a visitor whose browser prefers <locale> — like the defaults, it speaks THAT language.
 *
 *  Unset ⇒ the default. Blank ⇒ the default (a blank button is worse than the default one). A key
 *  that is not one of the three fields, or names a locale the site does not declare, is IGNORED
 *  and reported in `warnings` — a typo in a banner sentence must never fail a build.
 *  Returns { copy: { <data-locale>: { prompt?, continue?, dismiss? } }, warnings: string[] }. */
export const BANNER_OVERRIDE_PREFIX = 'locales-banner-';
export const BANNER_FIELDS = ['prompt', 'continue', 'dismiss'];
const _warned = new Set();
/** One line per distinct warning per build — the layout runs once per page. */
export function warnOnce(msg) { if (_warned.has(msg)) return; _warned.add(msg); console.warn(msg); }
export const BANNER_MAX_CHARS = 120;   // graphemes
/** Reserved meta key: the banner keys the PAGE's own frontmatter wrote (set by the page route). */
export const BANNER_PAGE_KEYS = 'locales-banner-page-keys';
/** The page route's half (tile#128 r2-1). `own` = the page's frontmatter, `siteConfig` = loadSite()
 *  for this page (base _site.md + its locale _site.md — the site layer), `merged` = own over it.
 *  Puts every banner key back to the site layer's value and records which ones the page wrote, so
 *  `page-level` is decided by where a key came from, never by whether its value differs. */
export function siteLayerBannerMeta(own, siteConfig, merged) {
  const out = merged || {};
  const cfg = siteConfig || {};
  const keys = Object.keys(own || {}).filter((k) => k.startsWith(BANNER_OVERRIDE_PREFIX) && k !== BANNER_PAGE_KEYS);
  for (const k of keys) { if (Object.prototype.hasOwnProperty.call(cfg, k)) out[k] = cfg[k]; else delete out[k]; }
  if (keys.length) out[BANNER_PAGE_KEYS] = keys; else delete out[BANNER_PAGE_KEYS];
  return out;
}
const _graphemes = (t) => (typeof Intl !== 'undefined' && Intl.Segmenter)
  ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)].map((x) => x.segment)
  : [...t];
/** `meta` = the site layer as the layout sees it (after siteLayerBannerMeta): base + locale
 *  _site.md values, plus BANNER_PAGE_KEYS naming the keys a page wrote (ignored, `page-level`). */
export function bannerOverrides(meta, locales) {
  const copy = {};
  const warnings = [];
  const findings = [];   // { key, reason, dropped? } — the same verdicts as `warnings`, for reef verify_site
  const note = (reason, key, msg, extra) => { findings.push({ key, reason, ...(extra || {}) }); warnings.push(`[${reason}] ${msg}`); };
  if (!meta || typeof meta !== 'object') return { copy, warnings, findings };
  for (const key of (Array.isArray(meta[BANNER_PAGE_KEYS]) ? meta[BANNER_PAGE_KEYS] : [])) {
    note('page-level', key, `\`${key}\` in a page's frontmatter is ignored: the banner sentences are set in _site.md (or a locale's own _site.md).`);
  }
  let declared = [];
  try { declared = parseLocales(locales); } catch { declared = []; }
  for (const key of Object.keys(meta)) {
    if (!key.startsWith(BANNER_OVERRIDE_PREFIX) || key === BANNER_PAGE_KEYS) continue;
    const rest = key.slice(BANNER_OVERRIDE_PREFIX.length);
    const m = rest.match(/^(.+)-([a-z]+)$/i);
    const field = m ? m[2].toLowerCase() : '';
    if (!m || !BANNER_FIELDS.includes(field)) {
      note('unknown-field', key, `\`${key}\` is ignored: a banner key ends in one of ${BANNER_FIELDS.join(', ')} (e.g. ${BANNER_OVERRIDE_PREFIX}zh-tw-prompt).`);
      continue;
    }
    const loc = declared.find((l) => sameLocale(l, m[1]));
    if (!loc) {
      note('undeclared-locale', key, `\`${key}\` is ignored: "${m[1]}" is not one of this site's locales (${declared.join(', ') || 'none declared'}).`);
      continue;
    }
    if (!_canon(loc)) {
      note('banner-unsupported-locale', key, `\`${key}\` sets copy for "${loc}", but the banner is only offered to browsers preferring en, ja, zh-TW or ko — visitors preferring ${loc} are never shown it.`);
    }
    const raw = meta[key];
    const text = (typeof raw === 'string' || typeof raw === 'number') ? String(raw).replace(/\s+/g, ' ').trim() : '';
    if (!text) continue;
    let cut = text;
    const g = _graphemes(text);
    if (g.length > BANNER_MAX_CHARS) {
      cut = g.slice(0, BANNER_MAX_CHARS).join('');
      const dropped = g.slice(BANNER_MAX_CHARS).join('');
      note('too-long', key, `\`${key}\` is longer than ${BANNER_MAX_CHARS} characters and was cut; dropped: "${[..._graphemes(dropped)].slice(0, 20).join('')}${_graphemes(dropped).length > 20 ? '…' : ''}".`, { dropped });
    }
    const id = _canon(loc) || loc;
    (copy[id] ||= {})[field] = cut;
  }
  return { copy, warnings, findings };
}

/** The suggestion banner's config for ONE page, or null when the page has nothing to suggest.
 *
 *  `altLocales` is the MEASURED set — the locales this page really exists in, the same list its
 *  hreflang tags and the footer link's `?has=` are built from. The options are that set minus the
 *  page being read.
 *
 *  🩸 2026-10-11. Options were `locales` minus the current one: every DECLARED language, existing
 *  or not. A page written only in the default language still asked a visitor whose browser spoke
 *  the other one whether they would rather read it there, and the button went to a 404. The page
 *  already knew better — two lines above, hreflang and `?has=` read the measured set. Third
 *  consumer of one fact, and the only one still guessing.
 *
 *  `routeLocales` is a SECOND measurement of the same fact, from a generated blog route: the
 *  locales whose build emits this same url (lib/blog.mjs → blogSwitchLocales). It is added to
 *  the content one, never used instead of it.
 *
 *  🩸 2026-10-11, the same day. The layout let the route's answer REPLACE the content one. On a
 *  root-mounted blog `/` is the blog index; a second language with no posts yet but a home page
 *  of its own was known to the content measurement (the page emitted hreflang to it) and not to
 *  the route's — so that site's home page lost its banner while its other edition existed. Each
 *  measurement says "this page exists there" and each is true, so the answer is the union.
 *
 *  No options → null, so the page ships neither the banner markup nor its script. */
export function suggestionBanner({ locales = [], lang = '', defaultLocale = '', altLocales = [], routeLocales = null, copy = null } = {}) {
  const declared = parseLocales(locales);
  if (declared.length < 2) return null;
  const pageLocale = localeOf(locales, lang);
  const fromContent = _list(altLocales);
  // No route measurement → the content set exactly as given (an archive route hands its own list
  // there, in its own order). With one → the union, in `locales` order, each locale once.
  const exists = Array.isArray(routeLocales)
    ? declared.filter((l) => routeLocales.includes(l) || fromContent.includes(l))
    : fromContent;
  const options = exists.filter((l) => !sameLocale(l, pageLocale))
    .map((l) => {
      // tile#128 r1: each sentence falls back on its own — override → that locale's default → en.
      const own = (copy && copy[_canon(l) || l]) || {};
      const def = bannerCopy(l); const en = LINGO_BANNER['en-US'];
      const pick = (f) => own[f] || def[f] || en[f];
      return { id: toUrlLocale(l), match: prefixes(l), prompt: pick('prompt'), continue: pick('continue'), dismiss: pick('dismiss') };
    });
  if (!options.length) return null;
  return {
    current: toUrlLocale(pageLocale),
    defaultLocale: toUrlLocale(defaultLocale),
    hrefStrategy: 'prefix',
    excludePath: '/language',
    options,
  };
}

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

/** "Home", for a page at `pathname`: the home of the locale that page's URL sits under. `/` for a
 *  default-locale page (and for every page of a site that declares no locales), `/<url-locale>/`
 *  under any other declared locale. The header logo, the sidebar logo and the footer mark all read
 *  this; so does the inbox form's success card.
 *
 *  It reads the BUILT PATH, not the page's `lang:` — the prefix a visitor is standing under is the
 *  one fact that cannot disagree with the URL they came from.
 *
 *  `contentRels` (contentRelsOf's set) makes it MEASURED: the locale prefix is used only when that
 *  locale's home CONTENT FILE exists in the set, `/` otherwise. It is a measurement of content
 *  files, not of built pages: a file that exists but is never built into a page (a `home.md` with
 *  no `sitetile-page:`) still counts, exactly as it does for hreflang. Leave `contentRels` out and
 *  the prefix alone decides.
 *
 *  🩸 CVERInc/reef#1891. The success card's "Back to homepage" was a literal `/` one line below a
 *  "Send another" link that carried the locale, so a visitor who had just written in one language
 *  was sent to the other one's home. The logo already had the right answer, inline in the layout
 *  where the card could not reach it — the fix is that there is one of it now, not a second. */
export function localeHomePath({ locales = [], pathname = '/', contentRels = null } = {}) {
  const list = parseLocales(locales);
  const defaultLocale = defaultLocaleOf(list);
  const first = String(pathname || '/').replace(/^\/+|\/+$/g, '').split('/')[0];
  if (!first || first === toUrlLocale(defaultLocale)) return '/';
  if (!list.some((l) => toUrlLocale(l) === first)) return '/';
  // Same measurement as hreflang, `?has=` and the suggestion banner: does this locale have a home?
  if (contentRels != null && !alternateLocales({ locales: list, defaultLocale, contentRels })
    .some((l) => toUrlLocale(l) === first)) return '/';
  return `/${first}/`;
}

/** content/**\/*.md glob keys → the rel paths alternateLocales() matches against
 *  ("home", "about", "ja-jp/about", "legal/terms"). `_site`/`_theme` are site DATA, not pages —
 *  the router skips them, so this must too, or a config file would vouch for a locale. */
export function contentRelsOf(contentGlob) {
  const out = new Set();
  for (const path of Object.keys(contentGlob || {})) {
    if (/(^|\/)_(site|theme)\.md$/.test(path)) continue;
    // Strip through the FIRST `/content/` only: keys are `<prefix>/content/<rel>.md` (`/content/…`,
    // `../../content/…`), the prefix is never a content dir, and a `content` directory below the
    // root is just a directory (#143). split('/content/')[1] cut the rel at the second one.
    const s = String(path);
    const at = s.indexOf('/content/');
    const rel = at < 0 ? '' : s.slice(at + '/content/'.length);
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
    inboxSent: "Thanks — your message is on its way.", inboxError: 'Could not send — please try again.',
    announceLabel: 'Announcement', announceClose: 'Close', announceEndsIn: 'Ends in ',
    month: (n) => EN_MONTHS[Number(n) - 1] || String(n), countWrap: [' (', ')'] },
  'zh-TW': { recent: '最新文章', tags: '標籤雲', archive: '所有貼文', search: '搜尋......',
    tagPrefix: '顯示具有以下標籤的文章：', datePrefix: '發表於：',
    authorPrefix: '作者：', categoryPrefix: '分類：', pageSuffix: (n) => `（第 ${n} 頁）`,
    noMatches: '沒有符合的文章', clearFilter: '\u2715 清除篩選', monthShort: (n) => `${Number(n)}月`,
    ageBack: '返回', ageConfirm: '是',
    notFoundTitle: '找不到頁面', notFoundBody: '這個網站上沒有這個網址。', notFoundHome: '回到首頁',
    inboxSent: '訊息已送出，謝謝。', inboxError: '傳送失敗，請再試一次。',
    announceLabel: '公告', announceClose: '關閉', announceEndsIn: '倒數 ',
    month: (n) => `${Number(n)}月`, countWrap: ['（', '）'] },
  'ja-JP': { recent: '最新の記事', tags: 'タグクラウド', archive: 'すべての記事', search: '検索......',
    tagPrefix: 'タグ：', datePrefix: '投稿日：',
    authorPrefix: '投稿者：', categoryPrefix: 'カテゴリー：', pageSuffix: (n) => `（${n}ページ目）`,
    noMatches: '一致する記事はありません', clearFilter: '\u2715 絞り込みを解除', monthShort: (n) => `${Number(n)}月`,
    ageBack: '戻る', ageConfirm: 'はい',
    notFoundTitle: 'ページが見つかりません', notFoundBody: 'このサイトにそのアドレスはありません。', notFoundHome: 'ホームへ',
    inboxSent: '送信しました。ありがとうございます。', inboxError: '送信できませんでした。もう一度お試しください。',
    announceLabel: 'お知らせ', announceClose: '閉じる', announceEndsIn: '残り ',
    month: (n) => `${Number(n)}月`, countWrap: ['（', '）'] },
  'ko-KR': { recent: '최근 글', tags: '태그 클라우드', archive: '모든 글', search: '검색...',
    tagPrefix: '태그: ', datePrefix: '게시일: ',
    authorPrefix: '작성자: ', categoryPrefix: '카테고리: ', pageSuffix: (n) => ` (${n}페이지)`,
    noMatches: '일치하는 글이 없습니다', clearFilter: '\u2715 필터 해제', monthShort: (n) => `${Number(n)}월`,
    ageBack: '돌아가기', ageConfirm: '예',
    notFoundTitle: '페이지를 찾을 수 없습니다', notFoundBody: '이 사이트에 해당 주소가 없습니다.', notFoundHome: '홈으로',
    inboxSent: '메시지가 전송되었습니다. 감사합니다.', inboxError: '전송하지 못했습니다. 다시 시도해 주세요.',
    announceLabel: '공지', announceClose: '닫기', announceEndsIn: '남은 시간 ',
    month: (n) => `${Number(n)}월`, countWrap: [' (', ')'] },
};
import { DEFAULT_LANG, inboxFormCopy } from './inbox-form-copy.js';
export { DEFAULT_LANG, inboxFormCopy };


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
