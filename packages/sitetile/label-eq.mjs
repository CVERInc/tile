// label-eq.mjs — where a `Label=href` item splits. Pure, import-free and side-effect-free: the
// renderer's chrome reader (chrome-links.mjs) and the reference renderer (site-core.js, which the
// editor bundles) both import it, so the bundle carries these few lines and not the whole reader.
//
// THE RULE (tile-lab#69), in one sentence: an item splits at its first `=` followed by a link target
// — a strong one (`http(s)://`, `//`, `/`, `#`, `?`, `mailto:`, `tel:`) or a bare path with no `=`
// before its `?`/`#` — except that a later `=` followed by a strong target takes the split unless it
// ends a `key=` in the query of the target chosen so far; with no such `=`, it splits at the last
// `=`, exactly as it always did.
//
// So a target keeps every `=` of its query (`Shop=/p?a=1&b=2`, `In=/login?next=/home`), and a label
// keeps the `=` it held before (`a=b=/c`, `x=/y=/z`, `C#=F#=/langs`, `Q=A?=/faq`, `Rating=#1=/top`).
// Before, every reader split at the LAST `=`, which cut every query string in two.
// (blog-post-cta is not this grammar: it always split at the first `=` and keeps the whole rest.)

const LINE_BREAK = /[\n\r\u2028\u2029]/;
const STRONG_LEAD = /^(?:https?:\/\/|mailto:|tel:|[/#?])/i;
// The split before tile-lab#69: the LAST `=` that has a whitespace-free run after it. Still the
// answer when no `=` is followed by a target (`Label==` stays label `Label`, href `=`).
const LEGACY_EQ_HREF = /^(.*\S)\s*=\s*(\S+)$/;
// header-actions before tile-lab#69: `aria-label = icon type target …`, at the last `=`.
const LEGACY_EQ_SPEC = /^(.*\S)\s*=\s*(\S.*)$/;

/** A strong link target: one whitespace-free run that starts with a scheme or a path lead. */
const isStrong = (t) => STRONG_LEAD.test(t) && !/\s/.test(t);
/** A bare relative path: whitespace-free, no `=` before its `?`/`#`. */
const isBare = (t) => t !== '' && !/\s/.test(t) && !t.split(/[?#]/)[0].includes('=');
/** Is `s` a link target as a `Label=href` item reads one (strong or bare)? */
export function isLinkTarget(s) {
  const t = String(s ?? '');
  return isStrong(t) || isBare(t);
}
// `target` is the chosen target up to a later `=`: that `=` is part of its query when a `?` came
// before it and it closes a non-empty key (`?next=`, `&b=`; not `?=` or `&=`).
const endsQueryKey = (target) => target.includes('?') && /[^?&]$/.test(target);

const fromMatch = (s, m) => (m ? { label: m[1].trim(), rest: m[2], restAt: s.length - m[2].length } : null);

/** Split a `Label=href` item. → { label (trimmed), rest (the href), restAt (offset of rest in text) }
 *  | null when the item has no `=href`. */
export function splitLabelEq(text) {
  const s = String(text ?? '');
  let pick = null;
  for (let i = s.indexOf('='); i >= 0; i = s.indexOf('=', i + 1)) {
    const head = s.slice(0, i).trimEnd();
    if (LINE_BREAK.test(head)) break;          // a label never spans a line break
    if (!head.trim()) continue;
    const raw = s.slice(i + 1);
    const rest = raw.trimStart();
    const restAt = i + 1 + raw.length - rest.length;
    if (!pick) {
      if (isLinkTarget(rest)) pick = { label: head.trim(), rest, restAt };
    } else if (isStrong(rest) && !endsQueryKey(s.slice(pick.restAt, i))) {
      pick = { label: head.trim(), rest, restAt };
    }
  }
  return pick || fromMatch(s, s.match(LEGACY_EQ_HREF));
}

// header-actions: the spec is one line, and only its third word (the target, an href) may hold `=`.
const isActionSpec = (r) => r !== '' && !LINE_BREAK.test(r) && r.split(/\s+/).every((w, j) => j === 2 || !w.includes('='));

/** Split a header action `aria-label = icon type target [reveal] [flags…]` at the first `=` after
 *  which only the target word holds `=` (else at the last `=`, as before). Same shape as above;
 *  `rest` is the untrimmed spec. */
export function splitLabelSpec(text) {
  const s = String(text ?? '');
  for (let i = s.indexOf('='); i >= 0; i = s.indexOf('=', i + 1)) {
    const head = s.slice(0, i).trimEnd();
    if (LINE_BREAK.test(head)) break;
    if (!head.trim()) continue;
    const raw = s.slice(i + 1);
    const rest = raw.trimStart();
    if (isActionSpec(rest)) return { label: head.trim(), rest, restAt: i + 1 + raw.length - rest.length };
  }
  return fromMatch(s, s.match(LEGACY_EQ_SPEC));
}

/** The split as it was before tile-lab#69 (last `=`), for comparing old and new readings. */
export const legacySplitLabelEq = (text) => { const s = String(text ?? ''); return fromMatch(s, s.match(LEGACY_EQ_HREF)); };
export const legacySplitLabelSpec = (text) => { const s = String(text ?? ''); return fromMatch(s, s.match(LEGACY_EQ_SPEC)); };
