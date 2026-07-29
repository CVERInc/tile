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

// **bold** / *italic* (asterisks, which work intraword) and __bold__ / _italic_ (underscores) over
// escaped text. Bold wins the alternation; the single-delimiter italic branch needs a non-space
// right after the opener so "a * b" / "a _ b" stay literal.
//
// 🔴 Underscores follow CommonMark's INTRAWORD rule — an opening or closing `_` may not touch an
// alphanumeric — so `snake_case`, `file_name` and `a_b_c` stay literal and only asterisks emphasise
// mid-word. Without that rule a page rendering ordinary prose grew bare underscores wherever an
// identifier appeared, which is the bug this arrived from.
function markBoldItalic(escaped, prefix) {
  const p = prefix || 'tg';
  const RE = /(\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*?\*|(?<![A-Za-z0-9])__[^_\n]+__(?![A-Za-z0-9])|(?<![A-Za-z0-9])_[^_\s][^_\n]*?_(?![A-Za-z0-9]))/g;
  return String(escaped).replace(RE, (m) => {
    const marker = m.startsWith('**') ? '**' : m.startsWith('__') ? '__' : m[0] === '*' ? '*' : '_';
    const cls = (marker === '**' || marker === '__') ? p + '-b' : p + '-i';
    const inner = m.slice(marker.length, m.length - marker.length);
    return '<span class="' + cls + '">' + mk(p, marker) + inner + mk(p, marker) + '</span>';
  });
}

// `code` over escaped text — single backticks, no newline inside.
function markCode(escaped, prefix) {
  const p = prefix || 'tg';
  return String(escaped).replace(/(`[^`\n]+`)/g, (m) => {
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
function renderInlineMd(text, opts) {
  const prefix = (opts && opts.prefix) || 'tg';
  // Escape FIRST (whole string), then run the marker passes over escaped text — same order as
  // editor-core.js (escHtml(line).replace(...)). The markers **, *, ` are unaffected by escaping.
  return markCode(markBoldItalic(escHtml(text), prefix), prefix);
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

export { renderInlineMd, markBoldItalic, markCode, cssContract, escHtml };
