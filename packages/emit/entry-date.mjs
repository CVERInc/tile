// The ONE way a blog list card writes its date — blog index, term/date archives, both tag-label
// pages, and the archive island that rebuilds the list in the browser for a ?ym= / ?tag= filter.
//
// 🩸 2026-11-08. The `cjk-badge` date is three spans. The server views wrote them on separate
// template lines, so whitespace sat between them; the island built them with createElement and
// none, so a filtered month read 「2月192024」 next to the page's own 「2月 19 2024」, and a site
// patched it with `gap` in its theme. Every other format was worse: the island printed the raw
// index date where the server printed the site's chosen format. Two hand-kept copies of one card.
//
// The split, so neither side carries the other's weight:
//   SERVER  resolves a `spec` once per page (blog.mjs entryDateSpec): which format, which Intl
//           locale, and — for the badge — the 12 short month labels from the locale tables.
//           That keeps the tables and the CJK gating server-side.
//   HERE    turns (date, spec) into one tree, and the tree into HTML. The island renders the same
//           tree with createElement/createTextNode (never innerHTML), so the two cannot differ.
//
// Dependency-free on purpose: the archive island imports this into a browser bundle.
//
// spec shapes (JSON-safe; the server hands it to the island as `data-bl-date` on `.bl-list`):
//   { badge: true, months: [12 short labels] }
//   { format: 'ymd-slash' | 'cjk-full' | 'cjk-md' }
//   { format: 'intl', tag }          — the locale default; `tag` is already validated server-side

/** The badge spans, in order. The whitespace between them is part of the markup: a theme that
 *  lays the badge out as flex/grid never sees it, and one that leaves it inline reads 2月 19 2024. */
export const BADGE_SPANS = ['bl-date-month', 'bl-date-day', 'bl-date-year'];
const BADGE_GAP = ' ';

const INTL_OPTS = { year: 'numeric', month: 'long', day: 'numeric' };

/** A date as text, per a non-badge spec. */
export function dateText(d, spec) {
  switch (spec && spec.format) {
    case 'ymd-slash': // 2026/05/20
      return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    case 'cjk-full': // 2025 年 11 月 11 日
      return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
    case 'cjk-md': // 4月8日
      return `${d.getMonth() + 1}月${d.getDate()}日`;
    default: {
      try {
        return new Intl.DateTimeFormat(spec ? spec.tag : undefined, INTL_OPTS).format(d);
      } catch {
        return new Intl.DateTimeFormat('en-US', INTL_OPTS).format(d);
      }
    }
  }
}

/** month / day / year strings for the badge. An unparseable date gives three empty strings. */
export function badgeParts(s, months) {
  const d = new Date(s);
  if (isNaN(d)) return { month: '', day: '', year: '' };
  const m = Array.isArray(months) ? months[d.getMonth()] : '';
  return { month: m || String(d.getMonth() + 1), day: String(d.getDate()), year: String(d.getFullYear()) };
}

/** The card's <time> as a tree: { cls, children } where a child is a text string or { cls, text }
 *  (a <span>). An unparseable date in a text format is printed as written, as fmtDate always did. */
export function entryDate(s, spec) {
  if (spec && spec.badge) {
    const p = badgeParts(s, spec.months);
    const vals = [p.month, p.day, p.year];
    const children = [];
    BADGE_SPANS.forEach((cls, i) => {
      if (i) children.push(BADGE_GAP);
      children.push({ cls, text: vals[i] });
    });
    return { cls: 'bl-date bl-date-badge', children };
  }
  const d = new Date(s);
  return { cls: 'bl-date', children: [isNaN(d) ? String(s) : dateText(d, spec)] };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The same tree as an HTML string, for the server views (`set:html`). */
export function entryDateHtml(s, spec) {
  const t = entryDate(s, spec);
  const inner = t.children.map((c) => (typeof c === 'string' ? esc(c) : `<span class="${esc(c.cls)}">${esc(c.text)}</span>`)).join('');
  return `<time class="${esc(t.cls)}">${inner}</time>`;
}
