// Chrome copy: the words a visitor reads that nobody authored, plus the helpers that resolve
// them. Deliberately imports no build alias — same reason as the sibling sitemap.mjs: a pure
// function parked behind `@sitetile` is a function no test can reach, and unreachable string
// resolution is how five copies of the same Chinese literal lived in this renderer for months.
import { uiCopy as lingoUiCopy, NEUTRAL_UI_LANG } from '../packages/lingo/locale.mjs';

// dateBadgeParts: split a date into month/day/year strings for the `cjk-badge` index-card
// layout (three stacked <span>s a theme's CSS can lay out as a badge) — a real
// index cards show "11月" / "11" / "2025" as separate lines.
export function dateBadgeParts(s, lang) {
  const d = new Date(s);
  if (isNaN(d)) return { month: '', day: '', year: '' };
  // 🩸 the month was `${n}月` for every tenant. A compact badge wants a SHORT label, which is why
  // this reads monthShort and not month: "Jul", not "July", and not 7月 on an English site.
  return { month: lingoUiCopy(lang || NEUTRAL_UI_LANG).monthShort(d.getMonth() + 1), day: String(d.getDate()), year: String(d.getFullYear()) };
}

/** Sidebar/archive chrome copy for a site: the locale defaults, with the site's own overrides on
 *  top. ONE resolver, because the same widget markup is duplicated in BlogIndexView, PostView and
 *  ArchiveView — three copies of the strings meant a fix could land in one of them and look done.
 *  Overrides are per-key, so a site can rename one heading without adopting a whole vocabulary. */
export function sidebarCopy(meta = {}) {
  const base = lingoUiCopy(meta.lang || NEUTRAL_UI_LANG);
  const pick = (key, fallback) => {
    const v = meta[key] == null ? '' : String(meta[key]).trim();
    return v || fallback;
  };
  return {
    recent: pick('sidebar-recent', base.recent),
    tags: pick('sidebar-tags', base.tags),
    archive: pick('sidebar-archive', base.archive),
    search: pick('sidebar-search', base.search),
    month: base.month,
    count: base.count,
  };
}

/** Strip ONE pair of surrounding quotes without touching what is inside them.
 *
 *  🩸 2026-08-06. splitFrontmatter trims every value (site-core.js), which is right for almost
 *  everything and made one thing impossible: a value whose trailing space is significant. The tag
 *  archive's subhead is `prefix + tag`, so an English site needs to write `Posts tagged ` — and
 *  could not. Writing it bare lost the space ("Posts taggedarchive"); writing it quoted leaked the
 *  quotes, because that route read the value raw. The CJK default hid the whole thing for months by
 *  ending in a full-width colon, which supplies its own gap.
 *
 *  Quoting is therefore how a site says "this whitespace is mine". Trimming BEFORE unquoting would
 *  undo it, so this deliberately does not trim at all — splitFrontmatter already removed the
 *  incidental whitespace outside the quotes. */
export function unquote(v) {
  const s = String(v == null ? '' : v);
  const m = /^(['"])([\s\S]*)\1$/.exec(s);
  return m ? m[2] : s;
}

/** The archive subhead prefixes ("Posts tagged " / "發表於："), locale default plus site override.
 *  Same one-resolver rule as sidebarCopy: two routes render these and neither may own the string. */
export function archivePrefixes(meta = {}) {
  const base = lingoUiCopy(meta.lang || NEUTRAL_UI_LANG);
  const pick = (key, fallback) => {
    const raw = meta[key];
    if (raw == null) return fallback;
    const v = unquote(String(raw));
    return v === '' ? fallback : v;
  };
  return {
    tag: pick('blog-label-prefix', base.tagPrefix),
    date: pick('blog-date-prefix', base.datePrefix),
    author: pick('blog-author-prefix', base.authorPrefix),
    category: pick('blog-category-prefix', base.categoryPrefix),
  };
}
