// pagetile — flow (reflowable) engine (reef#2279). Platform-free: no DOM, no dependency.
//
// A FIXED page is its source (a comic image, a PDF page). A FLOW page is text whose pages are
// computed when it is read, from the font size and the viewport — so "page 7" means nothing once the
// reader changes the font, and resume has to remember a place in the TEXT instead. This file is that
// engine, kept pure so it is testable in plain Node like book-core:
//
//   layoutFlow(text, opts)       → { lines, pages }    break one flow page's text into lines, lines into pages
//   paginateBook(book, opts)     → { pages, total }     the whole book's computed pages: page N/M
//   positionAt(book, paged, i)   → Position             where the reader is, as text, not a page number
//   locate(paged, position)      → index                the computed page holding that text, at ANY layout
//   resolveOffset(text, pos)     → offset               re-anchor a position by its quote if the text moved
//
// Measuring: the browser host passes `measure(str, fontSize) → px` (canvas measureText with the
// page's real font); `defaultMeasure` is the stand-in Node uses — CJK 1em, latin ~0.55em, space
// 0.3em. The line breaker does not care which one it gets.
//
// It is NOT imported by book-core or by the fixed reader: flow-loader.js imports it with import()
// only when a book with a flow page opens, the same lazy-island rule the vision spec sets for the
// heavy client libraries (PDF.js / epub.js).
//
//   Line     = { start, end, width, height }          offsets into the text, [start, end)
//   FlowPage = { start, end, height }                  the pages tile the text: no gap, no overlap
//   Paged    = { pages: [Computed], total }
//   Computed = { pageId, kind: 'fixed', index }                      a fixed page, once
//            | { pageId, kind: 'flow', index, start, end, part, parts }   one computed page of a flow page
//   Position = { pageId, offset, quote }               offset into that flow page's text (0 on a fixed page)

import { flattenPages } from './book-core.js';

const DEFAULTS = { width: 360, height: 560, fontSize: 16, lineHeight: 1.5, paragraphGap: 0.5, headingScale: 1.3 };
const QUOTE_LEN = 32;

// Wide glyphs: CJK ideographs, kana, hangul, fullwidth forms and CJK punctuation — and the
// supplementary planes' kana and ideographs (Kana Supplement/Extended, CJK Extension B onwards), so
// an astral ideograph breaks per glyph like a BMP one. Every pattern built from this uses the `u`
// flag: it matches code points, never half a surrogate pair.
const WIDE = '\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6'
  + '\u{1AFF0}-\u{1B16F}\u{20000}-\u{3FFFD}';
const RE_WIDE = new RegExp('^[' + WIDE + ']$', 'u');
const RE_MARK = /^\p{M}$/u;
// A glyph: a base code point with the combining marks that follow it (é as e + U+0301, が as
// か + U+3099). A mark is never measured, broken or carried away on its own.
const RE_GLYPH = /\P{M}\p{M}*|\p{M}+/gu;
// Where the text a line ends with is a CR before its LF (CRLF): a hard break, no glyph width.
const RE_HARD_BREAK = /\r?\n/g;

function defaultMeasure(str, fontSize) {
  let em = 0;
  for (const ch of String(str)) {
    em += ch === ' ' || ch === '\t' ? 0.3 : ch === '\r' || ch === '\n' || RE_MARK.test(ch) ? 0 : RE_WIDE.test(ch) ? 1 : 0.55;
  }
  return em * fontSize;
}

// Break units: a latin word (with the spaces that follow it), or ONE wide glyph — CJK text may break
// between any two glyphs. A combining mark always stays in the unit of the glyph before it. Offsets
// are absolute in the text.
const RE_UNIT_SRC = '[' + WIDE + ']\\p{M}*[ \\t\\r]*|(?:[^ \\t\\r\\n' + WIDE + ']\\p{M}*)+[ \\t\\r]*|[ \\t\\r]+';
function unitsOf(text, from, to) {
  const units = [];
  const re = new RegExp(RE_UNIT_SRC, 'gu');
  re.lastIndex = from;
  let m;
  while ((m = re.exec(text)) && m.index < to) {
    const end = Math.min(m.index + m[0].length, to);
    const word = text.slice(m.index, end).replace(/[ \t\r]+$/, '');
    units.push({ start: m.index, end, word });
  }
  return units;
}

// Blocks: runs of non-blank lines (a paragraph, a heading, an image line). Each block starts on a new
// line; a heading block is set larger. The newlines between blocks belong to the block before them,
// so the lines (and so the pages) tile the text exactly.
function blocksOf(text) {
  const blocks = [];
  const re = /[^\n]*\S[^\n]*(?:\n[^\n]*\S[^\n]*)*/g;
  let m;
  while ((m = re.exec(text))) blocks.push({ start: m.index, end: m.index + m[0].length, heading: /^#{1,6}\s/.test(m[0]) });
  return blocks;
}

function layoutFlow(text, opts) {
  const o = Object.assign({}, DEFAULTS, opts);
  const measure = o.measure || defaultMeasure;
  const src = String(text || '');
  const lines = [];
  for (const block of blocksOf(src)) {
    const fs = block.heading ? o.fontSize * o.headingScale : o.fontSize;
    let line = null;
    const open = (start) => { line = { start, end: start, width: 0, height: fs * o.lineHeight, gap: 0, trail: 0 }; lines.push(line); };
    // a single \n (or \r\n) inside a paragraph is a hard line break; the break itself has no width
    // and stays in the line it ends, so LF and CRLF texts lay out the same
    const segs = [];
    RE_HARD_BREAK.lastIndex = block.start;
    for (let at = block.start, m; at <= block.end; at = m ? m.index + m[0].length : block.end + 1) {
      m = RE_HARD_BREAK.exec(src);
      if (m && m.index >= block.end) m = null;
      segs.push([at, m ? m.index : block.end]);
    }
    for (const [segStart, segEnd] of segs) {
      open(segStart);
      for (const u of unitsOf(src, segStart, segEnd)) {
        const w = measure(u.word, fs);
        if (line.width > 0 && line.width + line.trail + w > o.width) open(u.start);
        if (w > o.width) {
          // a word wider than a whole line (a long URL) is broken by character, never overflowed
          let at = u.start;
          for (const ch of u.word.match(RE_GLYPH)) {
            const cw = measure(ch, fs);
            if (line.width > 0 && line.width + cw > o.width) open(at);
            line.width += cw; line.trail = 0; at += ch.length;
          }
        } else {
          line.width += (line.width > 0 ? line.trail : 0) + w;
        }
        // trailing spaces hang at a line end and become the gap before the next word
        line.trail = measure(src.slice(u.start + u.word.length, u.end), fs);
      }
    }
    line.gap = o.fontSize * o.lineHeight * o.paragraphGap;   // the space after a paragraph
  }
  // the lines tile the text: each runs to the next one's start (blank lines and spaces included)
  if (lines.length) {
    lines[0].start = 0;
    for (let i = 0; i < lines.length - 1; i++) lines[i].end = lines[i + 1].start;
    lines[lines.length - 1].end = src.length;
  }
  // pages: lines while they fit the height (at least one, so a page always advances). A paragraph gap
  // may hang off the bottom of a page — it is space, not text — and is not carried to the next page.
  const pages = [];
  let page = null;
  for (const l of lines) {
    if (!page || (page.end > page.start && page.used + l.height > o.height)) {
      page = { start: l.start, end: l.start, height: 0, used: 0 }; pages.push(page);
    }
    page.end = l.end;
    page.height = page.used + l.height;
    page.used = page.height + l.gap;
  }
  for (const p of pages) delete p.used;
  for (const l of lines) delete l.trail;
  if (!pages.length) pages.push({ start: 0, end: src.length, height: 0 });
  return { lines, pages };
}

// paginateBook: every page in reading order; a fixed page is one computed page, a flow page as many as
// its text takes at this font size and viewport.
function paginateBook(book, opts) {
  const pages = [];
  for (const { page } of flattenPages(book || {})) {
    if (page.kind !== 'flow') { pages.push({ pageId: page.id, kind: 'fixed', index: pages.length }); continue; }
    const lay = layoutFlow(page.caption || '', opts);
    lay.pages.forEach((p, part) => pages.push({ pageId: page.id, kind: 'flow', index: pages.length, start: p.start, end: p.end, part, parts: lay.pages.length }));
  }
  return { pages, total: pages.length };
}

function pageText(book, pageId) {
  const e = flattenPages(book || {}).find((x) => x.page.id === pageId);
  return e ? e.page.caption || '' : '';
}

// positionAt: the reader is on computed page i → the text at the top of that page. The quote lets the
// position find its text again if the post was edited above it (resolveOffset).
function positionAt(book, paged, i) {
  const p = paged.pages[Math.max(0, Math.min(i, paged.pages.length - 1))];
  if (!p) return { pageId: '', offset: 0, quote: '' };
  if (p.kind !== 'flow') return { pageId: p.pageId, offset: 0, quote: '' };
  const text = pageText(book, p.pageId);
  return { pageId: p.pageId, offset: p.start, quote: text.slice(p.start, p.start + QUOTE_LEN) };
}

// locate: the computed page that holds a position's text, in THIS layout. An unknown page → 0.
function locate(paged, pos) {
  if (!pos) return 0;
  const mine = paged.pages.filter((p) => p.pageId === pos.pageId);
  if (!mine.length) return 0;
  if (mine[0].kind !== 'flow') return mine[0].index;
  const off = Math.max(0, Number(pos.offset) || 0);
  const hit = mine.find((p) => p.start <= off && off < p.end) || mine[mine.length - 1];
  return hit.index;
}

// resolveOffset: the stored offset if the quote is still there; else the quote's nearest occurrence;
// else the stored offset clamped to the text.
function resolveOffset(text, pos) {
  const src = String(text || '');
  const off = Math.max(0, Math.min(Number(pos && pos.offset) || 0, src.length));
  const q = pos && pos.quote;
  if (!q || src.startsWith(q, off)) return off;
  let best = -1;
  for (let i = src.indexOf(q); i !== -1; i = src.indexOf(q, i + 1)) {
    if (best === -1 || Math.abs(i - off) < Math.abs(best - off)) best = i;
  }
  return best === -1 ? off : best;
}

export { layoutFlow, paginateBook, positionAt, locate, resolveOffset, defaultMeasure, DEFAULTS };
