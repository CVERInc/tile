#!/usr/bin/env node
/* tile-cssmd Unit Tests (pure Node, no npm) — same loader approach as the family's core tests:
 * read the ES module, strip its `export {…}` footer, eval in a CommonJS sandbox, assert.
 *
 * Covers: bold / italic / code rendering, the marker-hiding contract (markers PRESENT but
 * wrapped in the hidden `*-mk` class), the namespace-neutral prefix param, adjacent + nested
 * markers, the "a * b" non-italic guard, HTML-escaping / XSS safety, and the CSS contract.
 *
 * Run: node test/cssmd.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('node:assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'packages', 'cssmd', 'cssmd.js'), 'utf8')
  .replace(/export\s*\{[\s\S]*?\};?\s*$/, '');   // drop the ESM export footer; functions become module-local
const sandbox = {};
new Function('module', 'exports', src + '\nObject.assign(module.exports, { renderInlineMd, cssContract, escHtml });')(
  { exports: sandbox }, sandbox);
const { renderInlineMd, cssContract, escHtml } = sandbox;

let pass = 0, fail = 0;
const eq = (a, b, msg) => { try { assert.strictEqual(a, b); pass++; } catch (_) { fail++; console.error('FAIL:', msg, '\n  got:', JSON.stringify(a), '\n  exp:', JSON.stringify(b)); } };
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL:', msg); } };
const has = (hay, needle, msg) => ok(String(hay).indexOf(needle) !== -1, msg + ' — expected to contain ' + JSON.stringify(needle) + '\n  in: ' + hay);
const not = (hay, needle, msg) => ok(String(hay).indexOf(needle) === -1, msg + ' — should NOT contain ' + JSON.stringify(needle) + '\n  in: ' + hay);

// Strip every <span...> and </span> → the visible text the user reads (markers included, since
// they live in the DOM as textContent even when display:none). Used to assert the round trip.
const textContent = (html) => html.replace(/<\/?span[^>]*>/g, '');

// ── default prefix (tg) ──────────────────────────────────────────────────────────────────────
eq(renderInlineMd('**bold**'),
   '<span class="tg-b"><span class="tg-mk">**</span>bold<span class="tg-mk">**</span></span>',
   'bold — exact tg output (matches editor-core.js highlightLineParts)');

eq(renderInlineMd('*italic*'),
   '<span class="tg-i"><span class="tg-mk">*</span>italic<span class="tg-mk">*</span></span>',
   'italic — exact tg output');

eq(renderInlineMd('`code`'),
   '<span class="tg-code"><span class="tg-mk">`</span>code<span class="tg-mk">`</span></span>',
   'code — exact tg output');

// ── markers present-but-hidden-classed (the core contract) ─────────────────────────────────────
{
  const h = renderInlineMd('**hi**');
  has(h, 'class="tg-mk">**<', 'bold markers are wrapped in tg-mk (hidden) spans');
  eq(textContent(h), '**hi**', 'round-trip: markers REMAIN in textContent (present, just hidden)');
}
{
  const h = renderInlineMd('`x`');
  has(h, 'class="tg-mk">`<', 'code backtick markers wrapped in tg-mk');
  eq(textContent(h), '`x`', 'code round-trip keeps backticks in textContent');
}

// ── namespace-neutral prefix ───────────────────────────────────────────────────────────────────
eq(renderInlineMd('**b**', { prefix: 'gd' }),
   '<span class="gd-b"><span class="gd-mk">**</span>b<span class="gd-mk">**</span></span>',
   'prefix gd — matches another host inline renderer output exactly');
{
  const h = renderInlineMd('`c`', { prefix: 'gp' });
  has(h, 'class="gp-code"', 'prefix gp applied to effect class');
  has(h, 'class="gp-mk">`<', 'prefix gp applied to marker class');
  not(h, 'tg-', 'no leakage of the default tg- prefix when overridden');
}

// ── another-host parity: feed it the SAME thing that host's inline bar feeds its renderer ───────
// That host's bar calls its renderer with pre-escaped input; here renderInlineMd escapes internally. A reply with no
// HTML-significant chars must produce byte-identical markup to that host's gd-* output.
eq(renderInlineMd('say **hi** and `go`', { prefix: 'gd' }),
   'say <span class="gd-b"><span class="gd-mk">**</span>hi<span class="gd-mk">**</span></span> and <span class="gd-code"><span class="gd-mk">`</span>go<span class="gd-mk">`</span></span>',
   'gd parity — mixed bold + code in a sentence');

// ── adjacent markers ───────────────────────────────────────────────────────────────────────────
{
  const h = renderInlineMd('**a****b**');
  eq(textContent(h), '**a****b**', 'adjacent bolds round-trip');
  eq((h.match(/class="tg-b"/g) || []).length, 2, 'two adjacent bold spans');
}
{
  const h = renderInlineMd('`a``b`');   // two adjacent code spans
  eq((h.match(/class="tg-code"/g) || []).length, 2, 'two adjacent code spans');
  eq(textContent(h), '`a``b`', 'adjacent code round-trip');
}
{
  const h = renderInlineMd('*a* *b*');
  eq((h.match(/class="tg-i"/g) || []).length, 2, 'two italics separated by a space');
}

// ── bold-vs-italic alternation (** wins) ───────────────────────────────────────────────────────
{
  const h = renderInlineMd('**bold** and *italic*');
  has(h, 'class="tg-b"', 'bold rendered');
  has(h, 'class="tg-i"', 'italic rendered');
  eq(textContent(h), '**bold** and *italic*', 'mixed bold+italic round-trip');
}

// ── the "a * b" guard (single * with a space after must NOT italicise) ─────────────────────────
{
  const h = renderInlineMd('a * b');
  not(h, 'tg-i', '"a * b" is not italicised (space after opening *)');
  eq(h, 'a * b', '"a * b" passes through untouched');
}
{
  // an unclosed/lonely marker stays literal
  const h = renderInlineMd('just * one star');
  not(h, 'tg-i', 'lonely * not italicised');
}

// ── nested-looking markers: inner is treated as literal text (no re-parse), matching source ────
{
  // `**a `code` b**` — the FIRST regex pass handles bold over the whole span; its inner text
  // still contains backticks, which the SECOND (code) pass then wraps. Assert both happen and
  // the text round-trips. (This documents the two-pass behaviour faithfully copied from source.)
  const h = renderInlineMd('**a `c` b**');
  has(h, 'class="tg-b"', 'outer bold present');
  eq(textContent(h), '**a `c` b**', 'bold-with-code-inside round-trips exactly');
}

// ── HTML escaping / XSS safety ─────────────────────────────────────────────────────────────────
eq(renderInlineMd('<script>'), '&lt;script&gt;', 'angle brackets escaped — no raw <script>');
not(renderInlineMd('<img src=x onerror=alert(1)>'), '<img', 'no live <img> tag survives');
eq(renderInlineMd('a & b'), 'a &amp; b', 'ampersand escaped');
{
  // markup INSIDE a bold span is escaped too
  const h = renderInlineMd('**<b>x</b>**');
  has(h, '&lt;b&gt;x&lt;/b&gt;', 'HTML inside bold is escaped, not rendered');
  not(h, '<b>x</b>', 'no live <b> injected via content');
}
eq(escHtml('<a & "q">'), '&lt;a &amp; "q"&gt;', 'escHtml: escapes & < > (quotes left — text position only)');
eq(escHtml(null), '', 'escHtml(null) → empty string (no "null" leak)');
eq(escHtml(undefined), '', 'escHtml(undefined) → empty string');

// idempotence: escaping already-escaped text doesn't double-encode the marks/content meaningfully
// (passing pre-escaped text, as an earlier host bar did, still renders correctly)
{
  const h = renderInlineMd(escHtml('**hi**'));
  has(h, 'class="tg-b"', 'pre-escaped input still renders bold (back-compat with esc()-first callers)');
}

// ── edge cases ─────────────────────────────────────────────────────────────────────────────────
eq(renderInlineMd(''), '', 'empty string → empty');
eq(renderInlineMd('plain text'), 'plain text', 'no markers → untouched');
eq(renderInlineMd(null), '', 'null → empty (no crash)');
eq(renderInlineMd(undefined), '', 'undefined → empty');
eq(renderInlineMd(42), '42', 'number coerced to string');

// ── CSS contract ───────────────────────────────────────────────────────────────────────────────
{
  const css = cssContract();
  has(css, '.tg-mk{display:none}', 'default CSS hides markers');
  has(css, '.tg-b{font-weight:700}', 'default CSS bolds');
  has(css, '.tg-i{font-style:italic}', 'default CSS italicises');
  has(css, '.tg-code{', 'default CSS styles code');
}
{
  const css = cssContract({ prefix: 'gd' });
  has(css, '.gd-mk{display:none}', 'prefix gd CSS');
  not(css, '.tg-', 'prefixed CSS has no tg leakage');
}
{
  const css = cssContract({ prefix: 'gd', scope: '.gd-answer' });
  has(css, '.gd-answer .gd-mk{display:none}', 'scoped CSS — matches another host .gd-answer .gd-mk rule');
}


// ── underscores: __bold__ / _italic_, and CommonMark's intraword rule ──────────────────────────
// 🔴 The rule is the point. Asterisks emphasise mid-word; underscores must NOT, or ordinary prose
// containing identifiers grows stray emphasis wherever one appears. Each pair below is a case that
// was seen rendering wrongly on a page before the rule existed.
{
  const r = (t) => renderInlineMd(t);

  eq(r('__bold__'), '<span class="tg-b"><span class="tg-mk">__</span>bold<span class="tg-mk">__</span></span>',
     '__bold__ renders as bold with hidden markers');
  eq(r('_italic_'), '<span class="tg-i"><span class="tg-mk">_</span>italic<span class="tg-mk">_</span></span>',
     '_italic_ renders as italic with hidden markers');

  // 🔴 The intraword guards. Note what they do and do not prove: with NO underscore support these
  // also pass, because an unsupported delimiter is literal anyway. They exist to stop a future
  // naive implementation — a plain /_[^_]+_/ — from shipping, which is the shape that produced the
  // bug on a live page. The two assertions above are the ones that fail without this change.
  for (const literal of ['snake_case', 'file_name_here', 'a_b_c', 'MY_CONST', 'x_1_2']) {
    eq(r(literal), literal, 'intraword underscore stays literal: ' + literal);
  }
  eq(r('a _ b'), 'a _ b', 'a lone underscore between spaces stays literal');
  eq(r('__'), '__', 'a bare pair with nothing inside stays literal');

  // asterisks are unaffected — they DO work mid-word, which is the asymmetry CommonMark specifies
  eq(r('intra*word*emphasis'),
     'intra<span class="tg-i"><span class="tg-mk">*</span>word<span class="tg-mk">*</span></span>emphasis',
     'asterisks still emphasise intraword');

  // and the round trip, which is what this whole module exists for
  for (const t of ['__bold__', '_italic_', 'snake_case', 'a __b__ c_d']) {
    eq(textContent(r(t)), t, 'textContent round-trips exactly: ' + t);
  }
}

// ── summary ────────────────────────────────────────────────────────────────────────────────────
console.log((fail ? '✗' : '✓') + ' tile-cssmd: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
