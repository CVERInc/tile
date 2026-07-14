'use strict';
// Representative corpus for highlightLineParts parity. Exercises BOTH the inline marks that move
// to cssmd (bold/italic/code) AND the block-level marks that stay in core (headings/lists/quote/
// strike/link/tag/date/tab) — so the parity gate catches ANY regression, inline or block.
module.exports = [
  // ── empty / plain ──
  '',
  'plain text',
  'no markers here at all',
  // ── bold ──
  '**bold**',
  'a **bold** word',
  '**bold at start** then text',
  'text then **bold at end**',
  '**multiple** **bolds** here',
  '**a****b**',                 // adjacent bolds
  '**bold with spaces inside**',
  // ── italic ──
  '*italic*',
  'an *italic* word',
  '*a* *b*',                    // two italics separated by space
  '*italic at start*',
  // ── the "a * b" guard (single * + space → NOT italic) ──
  'a * b',
  'just * one star',
  'star * with * spaces',
  'a * b * c',
  // ── bold vs italic alternation (** wins) ──
  '**bold** and *italic*',
  '*italic* and **bold**',
  '***triple***',
  // ── code ──
  '`code`',
  'inline `code` span',
  '`a``b`',                     // adjacent code
  '`code at start`',
  // ── nested-looking (two-pass: bold then code) ──
  '**a `c` b**',
  '`a *b* c`',
  '**bold** `code` *italic*',
  // ── strike (stays in core) ──
  '~~strike~~',
  'a ~~struck~~ word',
  '~~strike~~ and **bold**',
  // ── headings (stay in core) ──
  '# H1',
  '## H2 with **bold**',
  '### H3 with `code` and *italic*',
  '#### H4',
  '##### H5',
  '###### H6',
  '   ## indented heading',
  '- ### heading in list item',
  '- [ ] ### heading in task',
  // ── lists (stay in core) ──
  '- bullet',
  '* star bullet',
  '- bullet with **bold**',
  '- [ ] unchecked task',
  '- [x] checked task',
  '- [X] checked caps',
  '  - nested bullet',
  // ── quote (stays in core) ──
  '> quote',
  '> quote with *italic*',
  '>no space quote',
  // ── link (stays in core) ──
  '[[wikilink]]',
  'see [[the link]] here',
  '[[link]] and **bold**',
  // ── tag (stays in core) ──
  '#tag',
  'a #tag in text',
  'text #one #two tags',
  // ── date (stays in core) ──
  '@{2026-01-01}',
  '@@{time}',
  'due @{2026-06-24} today',
  // ── tab (stays in core) ──
  '\ttabbed line',
  'mid\ttab\tline',
  // ── HTML escaping ──
  '<script>alert(1)</script>',
  'a & b < c > d',
  '**<b>x</b>**',
  '`<code>`',
  // ── combined kitchen-sink ──
  '- [ ] **bold** task with `code` and *italic* and #tag and @{date}',
  '## **bold** heading with [[link]] and ~~strike~~',
  '> quote with **bold** `code` *italic* ~~strike~~ #tag',
];
