// label-eq.mjs — where a `Label=href` item splits. Pure, import-free and side-effect-free: the
// renderer's chrome reader (chrome-links.mjs) and the reference renderer (site-core.js, which the
// editor bundles) both import it, so the bundle carries these few lines and not the whole reader.
//
// THE RULE (tile-lab#69), in one sentence: an item splits at its last `=`, as it always has, when
// what follows is a link target that starts with `http://`, `https://`, `//`, `/`, `#`, `?`,
// `mailto:` or `tel:`; otherwise it splits at the first `=` that is followed by such a target;
// otherwise at the last `=`.
//
// What that means:
//   - Every item whose last-`=` reading already gave such a link reads EXACTLY as before — a label
//     keeps its `=` (`a=b=/c`, `C#=F#=/langs`), and so does everything else that read as a link.
//   - A link the last `=` cut in two is read whole: `Shop=/p?id=1`, `Top=#a=b`, `M=mailto:a@b?subject=x`.
//   - A bare relative path is not such a target, so `Rel=page.html?x=1` still splits at its last `=`
//     (label `Rel=page.html?x`, href `1`), as before; start the path with `/` to have it read whole.
//   - A link whose query value itself starts a link (`In=/login?next=/home`) keeps the old reading
//     (label `In=/login?next`, href `/home`): such an `=` must be written `%3D`, or the value's first
//     character percent-encoded (`In=/login?next=%2Fhome`).
// (blog-post-cta is not this grammar: it always split at the first `=` and keeps the whole rest.)
//
// One pass: the words of the item are found once, then each `=` is judged in constant time.

const WS = /\s/;
const LINE_BREAKS = ['\n', '\r', '\u2028', '\u2029'];
const TARGET_LEAD = /(?:https?:\/\/|mailto:|tel:|[/#?])/iy;
const leadsTargetAt = (s, at) => { TARGET_LEAD.lastIndex = at; return TARGET_LEAD.test(s); };
// The split before tile-lab#69: the LAST `=` that has a whitespace-free run after it.
const LEGACY_EQ_HREF = /^(.*\S)\s*=\s*(\S+)$/;
// header-actions before tile-lab#69: `aria-label = icon type target …`, at the last `=`.
const LEGACY_EQ_SPEC = /^(.*\S)\s*=\s*(\S.*)$/;

/** Is `s` a link target as the rule means one: one whitespace-free run that starts with
 *  `http://`, `https://`, `//`, `/`, `#`, `?`, `mailto:` or `tel:`? (Not a safety check.) */
export function isLinkTarget(s) {
  const t = String(s ?? '');
  return t !== '' && !WS.test(t) && leadsTargetAt(t, 0);
}

// The rule, for both grammars. A candidate `=` is one the old reader could have split at: a
// non-blank, one-line label before it, and after it (whitespace aside) a non-empty rest that is one
// whitespace-free run (href) or one line (spec). `target` is the rest itself (href) or its third
// word (spec). Pick the last candidate if its target leads a link, else the first candidate whose
// target does, else the last.
function split(text, spec) {
  const s = String(text ?? '');
  const n = s.length;
  const words = [];                                   // where each whitespace-free run starts
  for (const m of s.matchAll(/\S+/g)) words.push(m.index);
  if (!words.length) return null;
  // A label never spans a line break: no `=` after the first word that follows one can split.
  let brk = -1, lastBrk = -1;
  for (const c of LINE_BREAKS) {
    const a = s.indexOf(c);
    if (a >= 0 && (brk < 0 || a < brk)) brk = a;
    lastBrk = Math.max(lastBrk, s.lastIndexOf(c));
  }
  let labelEnd = n;
  if (brk >= 0) { let w = 0; while (w < words.length && words[w] < brk) w++; labelEnd = w < words.length ? words[w] : n; }
  // The rest must start at or after this: the last word of a value that ends in one (href), or the
  // last line (spec).
  const restFrom = spec ? lastBrk + 1 : (WS.test(s[n - 1]) ? Infinity : words[words.length - 1]);

  let k = 0, lastAt = -1, lastRest = -1, lastLeads = false, firstAt = -1, firstRest = -1;
  for (let i = s.indexOf('='); i >= 0 && i <= labelEnd; i = s.indexOf('=', i + 1)) {
    if (i <= words[0]) continue;                      // a blank label
    while (k < words.length && words[k] <= i) k++;    // words[k]: the first word that starts after i
    const glued = i + 1 < n && !WS.test(s[i + 1]);    // the rest starts right after the `=`
    const restAt = glued ? i + 1 : words[k];
    if (restAt === undefined || restAt < restFrom) continue;
    const targetAt = spec ? words[glued ? k + 1 : k + 2] : restAt;
    const leads = targetAt !== undefined && leadsTargetAt(s, targetAt);
    lastAt = i; lastRest = restAt; lastLeads = leads;
    if (leads && firstAt < 0) { firstAt = i; firstRest = restAt; }
  }
  if (lastAt < 0) return null;
  const [at, restAt] = lastLeads || firstAt < 0 ? [lastAt, lastRest] : [firstAt, firstRest];
  return { label: s.slice(0, at).trim(), rest: s.slice(restAt), restAt };
}

/** Split a `Label=href` item. → { label (trimmed), rest (the href), restAt (offset of rest in text) }
 *  | null when the item has no `=href`. */
export function splitLabelEq(text) { return split(text, false); }

/** Split a header action `aria-label = icon type target [reveal] [flags…]` by the same rule, where
 *  "what follows" is the spec and its link target is the spec's third word: at the last `=` when
 *  that word is a link target, else at the first `=` whose spec's third word is one, else at the
 *  last `=`. Same shape as above; `rest` is the untrimmed spec. */
export function splitLabelSpec(text) { return split(text, true); }

const fromMatch = (s, m) => (m ? { label: m[1].trim(), rest: m[2], restAt: s.length - m[2].length } : null);
/** The split as it was before tile-lab#69 (last `=`), for comparing old and new readings. */
export const legacySplitLabelEq = (text) => { const s = String(text ?? ''); return fromMatch(s, s.match(LEGACY_EQ_HREF)); };
export const legacySplitLabelSpec = (text) => { const s = String(text ?? ''); return fromMatch(s, s.match(LEGACY_EQ_SPEC)); };
