// tile-cssmd — the "render markdown with markers HIDDEN via CSS" primitive, extracted as a
// SHARED, zero-dependency, render-only module. The technique (born in marktile's "Seasoned"
// renderer, later reused by another host's inline bar): wrap each markdown MARKER in a hidden span
// (`<prefix>-mk`, hidden by `.<prefix>-mk{display:none}`) and the CONTENT in an EFFECT span
// (`<prefix>-b` bold / `<prefix>-i` italic / `<prefix>-code`). The rendered text shows the
// effect while the raw markers stay invisible-but-present in the DOM — so the text↔DOM round
// trip (getText reads textContent, markers included) stays exact, and a host that opts in
// hides the markers via one CSS rule.
//
// This is the INLINE subset of the family's `highlightLineParts` (editor-core.js), made
// namespace-neutral: the tile plugins use `tg-*`, another host uses `gd-*`, a preview
// bar could use `gp-*` — all from ONE source. The faithful superset of:
//   • editor-core.js highlightLineParts inline marks (tg-b / tg-i / tg-code) — markers in tg-mk
//   • another host's inline renderer (gd-b / gd-i / gd-code) — markers in gd-mk
// Covered marks: **bold**, *italic*, `code`. (Block-level marks — headings, lists, quotes,
// links, tags, dates, strike, tables — stay in the full editor core; this is the inline-only,
// host-agnostic primitive both bars actually need.)
//
// SECURITY: text content is HTML-escaped here, so a raw, untrusted markdown STRING is safe to
// pass directly. (An earlier host copy required callers to pre-escape — `inlineMd(esc(...))`.
// This module escapes for you, so `renderInlineMd(rawString)` is XSS-safe by itself. Passing
// already-escaped text still works: escaping is idempotent for the entities we emit.)

const ESC_RE = /[&<>]/g;
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

// Escape the HTML-significant chars in text content. Matches editor-core.js `escHtml`
// (& < >). Quotes aren't escaped because content is only ever placed in a text position,
// never inside an attribute value.
function escHtml(s) {
  return String(s == null ? '' : s).replace(ESC_RE, (c) => ESC_MAP[c]);
}

// Emit `<span class="<prefix>-mk">…</span>` — the hidden-marker wrapper. `marker` is a literal
// markdown delimiter (`**` / `*` / `` ` ``); it contains no HTML-significant chars, but we
// escape defensively so the contract ("everything that lands in the DOM went through escaping")
// holds unconditionally.
function mk(prefix, marker) {
  return '<span class="' + prefix + '-mk">' + escHtml(marker) + '</span>';
}

// ── The individual marker PASSES, each operating on ALREADY-ESCAPED text ──────────────────────
// These are the raw `.replace()` passes, factored out so a caller that ALREADY escaped (and may
// have injected other markup first — e.g. editor-core.js's highlightLineParts, which wraps block
// markers BEFORE the inline ones, with its strike pass running BETWEEN bold and code) can splice
// them into its own chain and stay BYTE-IDENTICAL. `renderInlineMd` is the escape-then-both-passes
// convenience wrapper most hosts want; these are the parts it's built from.
//
// CONTRACT: input is already HTML-escaped (run escHtml first). They do NOT escape — splicing them
// mid-chain must not double-encode. Pure, DOM-free.

// ── the emphasis tokeniser ──────────────────────────────────────────────────────────────────────
// Emphasis nesting is not a regular language, and `markBoldItalic` above is a regex, so it cannot
// do it: its bold branch is `\*\*[^*\n]+\*\*`, whose content may not contain an asterisk, so a
// nested `*italic*` terminates the match early and the bold is LOST. `**bold with *it* inside**`
// came out entirely italic. CommonMark specifies emphasis as a delimiter-run stack (§6.2, "process
// emphasis"); what follows is that algorithm, restricted to one line and to `*` / `_`.
//
// It produces the same marker–content–marker sandwich as every other mark here, so the round trip
// is unchanged: every delimiter character either lands inside a `<prefix>-mk` span or stays in the
// text as the literal it turned out to be. Nothing is dropped and nothing is invented.

// CommonMark's "Unicode punctuation character" is categories P and S. An edge (undefined) counts as
// whitespace, which is what the spec says about the start and end of a line.
function isMdPunct(c) { return c !== undefined && /[\p{P}\p{S}]/u.test(c); }
function isMdSpace(c) { return c === undefined || /\s/u.test(c); }

const EL_RE = /<(\/?)([a-zA-Z][\w-]*)[^>]*>/y;

// A `<` reaching this pass can only be markup the CALLER injected — escHtml turned every authored
// `<` into `&lt;` — so an element is OPAQUE: the characters inside it are not delimiters. This
// matters immediately: editor-core.js wraps block markers before the inline ones, so an asterisk
// bullet arrives here as `<span class="tg-mk">* </span>rest`, and without this the bullet's own `*`
// would be a candidate opener and could pair with real emphasis further along — emitting a span
// that opens inside the marker and closes outside it, which is not valid nesting.
// Returns the index just past the element, or `i` if this is not a tag at all.
function skipElement(s, i) {
  EL_RE.lastIndex = i;
  const m = EL_RE.exec(s);
  if (!m) return i;
  const openEnd = EL_RE.lastIndex;
  if (m[1]) return openEnd;                       // a stray closing tag — skip it and nothing else
  const tag = m[2].toLowerCase();
  let depth = 1, k = openEnd;
  while (depth > 0) {
    const c = s.indexOf('<', k);
    if (c < 0) return openEnd;                    // unbalanced — only the open tag is opaque
    EL_RE.lastIndex = c;
    const t = EL_RE.exec(s);
    if (!t) { k = c + 1; continue; }
    if (t[2].toLowerCase() === tag) depth += t[1] ? -1 : 1;
    k = EL_RE.lastIndex;
  }
  return k;
}

// The text a reader would see inside a stretch of markup — tags dropped, entities left alone. The
// flanking rules ask what character sits next to a delimiter, and next to an opaque element the
// honest answer is that element's own last (or first) rendered character: a code span ends in a
// backtick, an autolink ends in `>`, a bullet marker ends in a space. Calling every element
// "whitespace" instead was wrong in a way that hid itself — it made `` *a `*`* `` unclosable,
// because a closer preceded by whitespace cannot close, and the emphasis simply never appeared.
function elemText(s, from, to) { return s.slice(from, to).replace(/<[^>]*>/g, ''); }

// Pass 1 — split the text into runs of `*` / `_` and the text between them, deciding for each run
// whether it can open, can close, or both. That verdict comes from the characters on either side
// (the spec's left-flanking / right-flanking), which is why this cannot be done one delimiter at a
// time by a regex: `*` in `a * b` and `*` in `a *b*` are the same character in different company.
function scanRuns(s) {
  const nodes = [];
  let buf = '';
  const flush = () => { if (buf) { nodes.push({ t: 't', v: buf }); buf = ''; } };
  let i = 0, prev;                                // prev === undefined ⇒ an edge, i.e. whitespace
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {                             // an escaped character is never a delimiter, and
      buf += s.slice(i, i + 2);                   // the backslash must survive for markEscapes
      prev = s[i + 1]; i += 2; continue;
    }
    if (c === '<') {
      const end = skipElement(s, i);
      if (end > i) {
        buf += s.slice(i, end);
        const inner = elemText(s, i, end);
        prev = inner ? inner[inner.length - 1] : undefined;
        i = end; continue;
      }
      buf += c; prev = c; i++; continue;
    }
    if (c !== '*' && c !== '_') { buf += c; prev = c; i++; continue; }
    let j = i;
    while (s[j] === c) j++;
    let next = s[j];
    if (next === '<') {
      const end = skipElement(s, j);
      if (end > j) { const inner = elemText(s, j, end); next = inner ? inner[0] : undefined; }
    }
    const beforeSpace = isMdSpace(prev), afterSpace = isMdSpace(next);
    const beforePunct = isMdPunct(prev), afterPunct = isMdPunct(next);
    const left = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
    const right = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
    flush();
    nodes.push({
      t: 'd', ch: c, n: j - i, orig: j - i,
      // Asterisks work intraword; underscores do not. That asymmetry is one extra clause here, and
      // it is what keeps `snake_case_name` literal — the rule a live page once lost, growing bare
      // underscores wherever an identifier appeared.
      canOpen: c === '*' ? left : left && (!right || beforePunct),
      canClose: c === '*' ? right : right && (!left || afterPunct),
    });
    prev = c; i = j;
  }
  flush();
  return nodes;
}

// Pass 2 — the spec's "process emphasis". Walk closers left to right; for each, find the nearest
// compatible opener to its left and fold everything between them into one node. Inner pairs are
// reached first, so `**a *b* c**` resolves the italic before the bold gets to it — the whole point.
// Delimiters that end up between a matched pair are never rewound: they are literal text, which is
// also what the spec says.
function processEmphasis(nodes) {
  let ci = 0;
  while (ci < nodes.length) {
    const closer = nodes[ci];
    if (closer.t !== 'd' || !closer.canClose || closer.n === 0) { ci++; continue; }
    let oi = -1;
    for (let k = ci - 1; k >= 0; k--) {
      const o = nodes[k];
      if (o.t !== 'd' || o.n === 0 || o.ch !== closer.ch || !o.canOpen) continue;
      // The spec's "rule of 3": when either side of the pair could play both parts, a match whose
      // combined ORIGINAL run lengths is a multiple of 3 is refused — unless both lengths are. It
      // reads like numerology and is not: it is what makes `*a**b**c*` an italic containing a bold
      // rather than the other way round.
      if ((closer.canOpen || o.canClose) && (closer.orig + o.orig) % 3 === 0 &&
          !(closer.orig % 3 === 0 && o.orig % 3 === 0)) continue;
      oi = k; break;
    }
    if (oi < 0) { ci++; continue; }
    const opener = nodes[oi];
    const use = (closer.n >= 2 && opener.n >= 2) ? 2 : 1;   // two delimiters is strong, one is em
    const kids = nodes.slice(oi + 1, ci);
    opener.n -= use; closer.n -= use;
    nodes.splice(oi + 1, ci - oi - 1, { t: 'e', use: use, mark: closer.ch.repeat(use), kids: kids });
    ci = oi + 2;                                  // the closer moved here; it may still have length
  }
}

// Pass 3 — serialize. A delimiter that never matched prints the characters it is made of, so the
// text comes back byte-for-byte: every character is either inside a marker span or still itself.
function renderNodes(nodes, p) {
  let out = '';
  for (const n of nodes) {
    if (n.t === 't') out += n.v;
    else if (n.t === 'd') out += n.n ? n.ch.repeat(n.n) : '';
    else out += '<span class="' + p + (n.use === 2 ? '-b' : '-i') + '">' +
                mk(p, n.mark) + renderNodes(n.kids, p) + mk(p, n.mark) + '</span>';
  }
  return out;
}

// **bold** / *italic* / __bold__ / _italic_ over escaped text, nesting correctly.
//
// Asterisks work intraword; underscores follow CommonMark's intraword rule (an opening or closing
// `_` may not sit between two alphanumerics), so `snake_case`, `file_name` and `a_b_c` stay literal.
// A backslash-escaped delimiter is not a delimiter at all — the scanner consumes `\*` as one unit —
// which also settles a case the old regex had to guess at: `\\*a*` is an escaped BACKSLASH followed
// by real emphasis, and it now emphasises, because the scanner counts backslashes instead of
// peering behind one.
function markEmphasis(escaped, prefix) {
  const s = String(escaped);
  if (s.indexOf('*') < 0 && s.indexOf('_') < 0) return s;   // most lines; skip the whole machine
  const nodes = scanRuns(s);
  processEmphasis(nodes);
  return renderNodes(nodes, prefix || 'tg');
}

// The name this primitive shipped under, kept because consumers outside this repo import it. New
// callers should use markEmphasis; this is the same function, not an older one.
function markBoldItalic(escaped, prefix) { return markEmphasis(escaped, prefix); }

// `code` over escaped text — single backticks, no newline inside.
function markCode(escaped, prefix) {
  const p = prefix || 'tg';
  // Same escape rule as the emphasis pass: `\`` is a literal backtick, not the start of a code span.
  return String(escaped).replace(/((?<!\\)`[^`\n]+`)/g, (m) => {
    const inner = m.slice(1, -1);
    return '<span class="' + p + '-code">' + mk(p, '`') + inner + mk(p, '`') + '</span>';
  });
}

// Render an INLINE markdown string into HTML with markers wrapped in hidden `*-mk` spans and
// content wrapped in effect spans. Pure, DOM-free, zero-dependency.
//
//   renderInlineMd(text, { prefix = 'tg' } = {})  →  HTML string
//
//   text    raw inline markdown (a single line / fragment). HTML-escaped internally → XSS-safe.
//   prefix  class namespace, default 'tg'. tile → 'tg', another host → 'gd', preview → 'gp'.
//
// Behaviour (faithful to editor-core.js highlightLineParts inline marks):
//   **bold**   → <span class="<p>-b"><span class="<p>-mk">**</span>bold<span class="<p>-mk">**</span></span>
//   *italic*   → <span class="<p>-i">…*…italic…*…</span>   (single * needs a non-space after it,
//                                                            so "a * b" is NOT italicised)
//   `code`     → <span class="<p>-code">…`…code…`…</span>
//   **bold** wins the alternation over *italic*; `code` is a separate pass. Content INSIDE the
//   marks is plain text (escaped) — no nested re-parsing, matching the source renderers exactly.
// The backslash of an escape is syntax, so it hides like every other marker — `\*` shows as `*`
// while the text still round-trips with the backslash in it.
//
// Runs LAST, after the emphasis and code passes, for a reason: those passes must still see the
// backslash in order to decline. Reversing the order would hide the backslash and then emphasise the
// text it was protecting, which is the bug with an extra step.
//
// Only the characters CommonMark says are escapable, so `C:\path` and `\n` in prose are left alone.
// 🔴 NOT inside a code span. CommonMark does not run backslash escapes there — a code span's content
// is literal — so `` `/^- \[(.)\]/` `` must keep its backslashes VISIBLE. This pass runs last and
// over the whole string, so without the skip it reached inside the span markCode had just built and
// hid characters that are part of the code. Found by rendering 168 of the owner's own documents with
// the old module and the new one and diffing: 270 lines moved, and this was the only one of them
// that moved the wrong way.
//
// markCode runs BEFORE this, so the span already exists and skipping it is a split, not a parse.
// Known and not fixed: an <autolink>'s URL is literal in the same way, but that span is built in
// editor-core and shares its class with ordinary links, whose text IS prose and must keep escaping.
// A backslash inside an autolink URL is rare enough to name rather than chase.
function markEscapes(escaped, prefix) {
  const p = prefix || 'tg';
  const s = String(escaped);
  const open = '<span class="' + p + '-code">';
  const sub = (t) => t.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, (m, ch) => mk(p, '\\') + ch);
  let out = '', i = 0;
  for (;;) {
    const j = s.indexOf(open, i);
    if (j < 0) return out + sub(s.slice(i));
    const end = skipElement(s, j);        // balanced: the span holds two nested marker spans
    const stop = end > j ? end : j + open.length;
    out += sub(s.slice(i, j)) + s.slice(j, stop);
    i = stop;
  }
}

function renderInlineMd(text, opts) {
  const prefix = (opts && opts.prefix) || 'tg';
  // Escape FIRST (whole string), then run the marker passes over escaped text — same order as
  // editor-core.js (escHtml(line).replace(...)). The markers **, *, ` are unaffected by escaping.
  //
  // CODE BEFORE EMPHASIS, which is the spec's precedence and was the other way round until
  // 2026-08-04: a code span's content is literal by definition, so `` `*` `` is an asterisk and not
  // a delimiter. Running emphasis first made ``*a `*`*`` pair the backtick's asterisk with the outer
  // one, and made `` `**a**` `` — documenting the syntax, which this repo does constantly — render
  // as bold inside the code span. markEmphasis treats the finished code span as opaque, so the
  // reorder is all the fix needs.
  return markEscapes(markEmphasis(markCode(escHtml(text), prefix), prefix), prefix);
}

// The CSS contract. Returns the stylesheet text a host must include for the technique to work:
//   • `.<prefix>-mk{display:none}` — HIDES the raw markers (the whole point).
//   • `.<prefix>-b{font-weight:700}` / `.<prefix>-i{font-style:italic}` — the bold/italic effects.
//   • `.<prefix>-code{…}` — monospace inline code. Colours are intentionally LEFT to the host
//     (another host tints code teal, marktile uses its own accent); this primitive ships only
//     the structural rules so consumers stay in control of their palette. Pass
//     `{ scope: '.gd-answer' }` to prefix every selector (e.g. only hide markers inside answers),
//     mirroring another host's `.gd-answer .gd-mk{display:none}`.
function cssContract(opts) {
  const prefix = (opts && opts.prefix) || 'tg';
  const scope = (opts && opts.scope) ? opts.scope + ' ' : '';
  return (
    scope + '.' + prefix + '-mk{display:none}' +
    scope + '.' + prefix + '-b{font-weight:700}' +
    scope + '.' + prefix + '-i{font-style:italic}' +
    scope + '.' + prefix + '-code{font-family:ui-monospace,Menlo,monospace;font-size:0.92em;border-radius:3px;padding:0 3px}'
  );
}

export { renderInlineMd, markBoldItalic, markEmphasis, markCode, markEscapes, cssContract, escHtml };
