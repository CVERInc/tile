#!/usr/bin/env node
// pagetile flow engine (reef#2279) — pure Node, no npm, no DOM.
//
// What this pins, one block per requirement of the ticket:
//   1. `kind: flow` is a page kind in the book model, and a fixed (comic / photobook) book's model is
//      exactly what it was before the word existed.
//   2. Pagination is COMPUTED: the same text gives more pages at a bigger font size and in a narrower
//      viewport, and every character lands on exactly one page.
//   3. Resume is a POSITION in the text, not a page number: after a font-size change the reader lands
//      on the page that holds the same text it was reading.
//   4. The flow engine is not loaded until a flow book opens.
//   5. Review regressions (tile#274 round 1): each case a reviewer found, pinned to its own check.
//
// Run: node test/pagetile-flow.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBook, serializeBook, flattenPages, isFlowPage, hasFlowPages } from '../packages/pagetile/book-core.js';
import { layoutFlow, paginateBook, positionAt, locate, resolveOffset, defaultMeasure } from '../packages/pagetile/flow-core.js';
import { createFlowLoader } from '../packages/pagetile/flow-loader.js';
import { loadReaderBook } from '../packages/sitetile/astro/src/lib/pagetile.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const eq = (a, b, msg) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (ok) pass++; else { fail++; console.error('FAIL:', msg, '\n  got:', JSON.stringify(a), '\n  exp:', JSON.stringify(b)); } };
// VERBOSE=1 prints every check with the numbers it measured (page counts, page indices)
const ok = (c, msg) => { if (process.env.VERBOSE) console.log((c ? 'ok   ' : 'FAIL ') + msg); if (c) pass++; else { fail++; console.error('FAIL:', msg); } };

// A long post: latin paragraphs, a CJK paragraph, a heading — enough text for many pages.
const PARA_EN = 'The ferry left before dawn, and the harbour lights went out one by one behind it while the gulls argued over the wake. ';
const PARA_ZH = '早晨的渡輪在天亮前出發，港口的燈一盞一盞熄滅，海鷗在船尾的浪花上爭吵不休。';
// Inside a flow page `#`/`##` would open a chapter/page, so the post's own headings are `###`+.
const POST = ['### A long morning', '', ...Array.from({ length: 12 }, (_, i) => (i % 3 === 2 ? PARA_ZH.repeat(4) : PARA_EN.repeat(3)) + ' (' + (i + 1) + ')').flatMap((p) => [p, ''])].join('\n').trim();

const FLOW_BOOK = [
  '---', 'pagetile-book: true', 'title: Morning ferry', '---', '',
  '# Chapter 1', '', '## Cover', '![[cover.png]]', '',
  '## The crossing', 'kind: flow', POST, '',
].join('\n');

// ── 1. the model ────────────────────────────────────────────────────────────────────────────
const fb = parseBook(FLOW_BOOK);
const [cover, crossing] = flattenPages(fb).map((e) => e.page);
eq(crossing.kind, 'flow', 'a page head `kind: flow` makes a flow page');
eq(flattenPages(fb).length, 2, 'the post\'s ### heading does not open a page');
ok(crossing.caption.includes('A long morning'), 'the flow text keeps the whole post body');
ok(!crossing.caption.includes('kind: flow'), 'the kind line is not part of the flow text');
ok(isFlowPage(crossing) && !isFlowPage(cover), 'isFlowPage tells flow from fixed');
ok(hasFlowPages(fb), 'hasFlowPages sees the flow page');
eq(serializeBook(parseBook(serializeBook(fb))), serializeBook(fb), 'a flow book round-trips');
eq(parseBook(serializeBook(fb)).chapters[0].pages[1].kind, 'flow', 'kind: flow survives the round-trip');

// fixed books: the model is unchanged (no `kind` key appears on a comic page)
const COMIC = ['---', 'pagetile-book: true', '---', '', '# C', '', '## P1', '![[a.png]]', 'kind: full', ''].join('\n');
const comic = parseBook(COMIC);
eq(Object.keys(comic.chapters[0].pages[0]), ['id', 'title', 'images', 'caption'], 'a comic page has no kind key');
eq(comic.chapters[0].pages[0].caption, 'kind: full', 'in a comic, `kind: full` is still caption text');
ok(!hasFlowPages(comic), 'a comic has no flow pages');
const PHOTO = ['---', 'pagetile-book: true', 'source: photobook', '---', '', '# C', '', '## P1', 'kind: mat', 'focus: 50% 38%', '![[a.jpg]]', ''].join('\n');
const photo = parseBook(PHOTO).chapters[0].pages[0];
eq([photo.kind, photo.focus], ['mat', '50% 38%'], 'photobook kinds are unchanged');

// ── 2. pagination changes with font size and viewport ─────────────────────────────────────
const text = crossing.caption;
const PHONE = { width: 360, height: 560 };
const TABLET = { width: 700, height: 560 };
const small = layoutFlow(text, { ...PHONE, fontSize: 16 });
const big = layoutFlow(text, { ...PHONE, fontSize: 24 });
const wide = layoutFlow(text, { ...TABLET, fontSize: 16 });
ok(small.pages.length >= 3, 'the long post spans several pages at 16px (' + small.pages.length + ')');
ok(big.pages.length > small.pages.length, 'a bigger font gives more pages (' + small.pages.length + ' → ' + big.pages.length + ')');
ok(wide.pages.length < small.pages.length, 'a wider viewport gives fewer pages (' + small.pages.length + ' → ' + wide.pages.length + ')');
for (const [name, lay] of [['16px phone', small], ['24px phone', big], ['16px tablet', wide]]) {
  // the pages tile the text: start at 0, each starts where the last ended, end at text.length
  const tiled = lay.pages.every((p, i) => p.start < p.end && (i === 0 ? p.start === 0 : p.start === lay.pages[i - 1].end));
  ok(tiled && lay.pages[lay.pages.length - 1].end === text.length, name + ': pages tile the whole text with no gap or overlap');
  // no line is wider than the viewport (a word that cannot fit alone is broken, not overflowed)
  ok(lay.lines.every((l) => l.width <= PHONE.width || name.includes('tablet')), name + ': no line overflows the width');
  // no page holds more line height than the viewport
  ok(lay.pages.every((p) => p.height <= (name.includes('tablet') ? TABLET : PHONE).height), name + ': no page overflows the height');
}
// breaks fall between words, never inside a latin word
ok(small.pages.slice(1).every((p) => !/[A-Za-z]/.test(text[p.start - 1] || '') || !/[A-Za-z]/.test(text[p.start])), 'a page break never splits a latin word');
// the default measure knows CJK is wider than latin
ok(defaultMeasure('早', 16) > defaultMeasure('a', 16), 'CJK glyphs measure wider than latin');

// a host can inject its own measure (canvas measureText in the browser): a wider font → more pages
const wideFont = layoutFlow(text, { ...PHONE, fontSize: 16, measure: (s, fs) => defaultMeasure(s, fs) * 1.5 });
ok(wideFont.pages.length > small.pages.length, 'an injected measure drives the line breaks');

// computed page N/M across the whole book: fixed pages count once, flow pages expand
const book16 = paginateBook(fb, { ...PHONE, fontSize: 16 });
const book24 = paginateBook(fb, { ...PHONE, fontSize: 24 });
eq(book16.total, 1 + small.pages.length, 'book page count = fixed pages + computed flow pages (16px)');
eq(book24.total, 1 + big.pages.length, 'book page count = fixed pages + computed flow pages (24px)');
eq(book16.pages[0], { pageId: cover.id, kind: 'fixed', index: 0 }, 'the fixed cover is one page, untouched');
const comic16 = paginateBook(comic, { ...PHONE, fontSize: 16 });
const comic40 = paginateBook(comic, { ...PHONE, fontSize: 40 });
eq(comic40, comic16, 'a fixed book paginates the same at any font size');

// ── 3. resume lands on the same text after reflow ─────────────────────────────────────────
// Read to the middle of the post at 16px, change to 24px, resume.
const at = Math.floor(book16.total * 0.6);
const pos = positionAt(fb, book16, at);
eq(pos.pageId, crossing.id, 'a position names the flow page');
ok(typeof pos.offset === 'number' && pos.offset === book16.pages[at].start, 'a position is a text offset (the top of the page), not a page number');
const after = locate(book24, pos);
ok(after !== at, 'the page NUMBER changed with the font (' + at + ' → ' + after + ') — which is why resume is not a page number');
const landed = book24.pages[after];
ok(landed.pageId === crossing.id && landed.start <= pos.offset && pos.offset < landed.end, 'resume at 24px lands on the page holding the same text');
// and back again
// (it resumes at the top of the 24px page, which may sit on the 16px page BEFORE the original one:
// each change of font keeps the text the reader is looking at, not the page they started on)
const pos24 = positionAt(fb, book24, after);
const back = locate(book16, pos24);
ok(book16.pages[back].start <= pos24.offset && pos24.offset < book16.pages[back].end, 'and back at 16px it lands on the page holding the 24px page\'s top text');
ok(Math.abs(back - at) <= 1, 'a round trip moves at most one page (' + at + ' → ' + back + ')');
// resume on a fixed page is its page
eq(locate(book24, positionAt(fb, book16, 0)), 0, 'a fixed page resumes to itself');
// a position survives an edit before it: the quote re-finds the text
ok(pos.quote && text.slice(pos.offset).startsWith(pos.quote), 'a position carries a quote of the text it points at');
const edited = 'A new opening line.\n\n' + text;
eq(resolveOffset(edited, pos), pos.offset + 'A new opening line.\n\n'.length, 'the quote re-anchors the position after text was inserted before it');
eq(resolveOffset(text, pos), pos.offset, 'an unedited text resolves to the stored offset');
// an unknown page id falls back to the first page instead of throwing
eq(locate(book24, { pageId: 'gone', offset: 5 }), 0, 'an unknown position resumes at the start');

// ── 4. libraries are not loaded until a flow book opens ───────────────────────────────────
let calls = 0;
const loader = createFlowLoader({ engine: () => { calls++; return import('../packages/pagetile/flow-core.js'); } });
eq(loader.loaded(), false, 'nothing is loaded when the loader is made');
eq(await loader.open(comic), null, 'opening a fixed book loads nothing');
eq(calls, 0, 'the engine importer was not called for a fixed book');
const libs = await loader.open(fb);
eq(calls, 1, 'opening a flow book imports the engine');
ok(typeof libs.engine.layoutFlow === 'function', 'the loaded engine is the flow engine');
await loader.open(fb);
eq(calls, 1, 'a second flow book reuses the loaded engine');
// the static graph: nothing a fixed reader imports reaches the flow engine
const staticImports = (f) => [...fs.readFileSync(path.join(HERE, '..', 'packages', 'pagetile', f), 'utf8')
  .matchAll(/^\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
ok(!staticImports('book-core.js').some((s) => s.includes('flow-core')), 'book-core does not statically import the flow engine');
ok(!staticImports('flow-loader.js').some((s) => s.includes('flow-core')), 'flow-loader reaches the engine only through import()');

// ── 5. review regressions (tile#274 round 1) ───────────────────────────────────────────────
const lineTexts = (src, lay) => lay.lines.map((l) => src.slice(l.start, l.end));
const PHOTO_HEAD = ['---', 'pagetile-book: true', 'source: photobook', '---', '# C', '## P', ''].join('\n');

// P1: `kind: flow` after a page-head field is NOT the first line — the fixed photobook page keeps
// exactly the model it had before flow existed (the image stays an image, the line stays caption).
const LATE_FLOW = PHOTO_HEAD + 'focus: 50% 38%\nkind: flow\n![[photo.jpg]]\n';
eq(parseBook(LATE_FLOW).chapters[0].pages[0],
  { id: 'c1-c-p1', title: 'P', images: [{ src: 'photo.jpg', alt: '', embed: 'wikilink' }], caption: 'kind: flow', kind: '', focus: '50% 38%' },
  'P1: a non-first `kind: flow` after focus leaves the photobook page byte-identical');
const lateReader = loadReaderBook(LATE_FLOW).chapters[0];
eq([lateReader.pages[0].imageSrc, lateReader.pages[0].thumbSrc, lateReader.coverSrc], ['/photo.jpg', '/photo.jpg', '/photo.jpg'],
  'P1: the reader still shows the photo of that page (imageSrc / thumbSrc / coverSrc)');
eq(parseBook(PHOTO_HEAD + 'focus: 50% 38%\nkind: flow\n').chapters[0].pages[0].kind, '',
  'P1: `kind: flow` after focus with nothing else is caption too');
eq(parseBook(PHOTO_HEAD + 'kind: mat\nkind: flow\n![[a.jpg]]\n').chapters[0].pages[0].kind, 'mat',
  'P1: `kind: flow` after another kind line does not open a flow page');
eq(parseBook(PHOTO_HEAD + '\nkind: flow\nBody\n').chapters[0].pages[0].kind, 'flow',
  'P1: blank lines before the marker still leave it the first line');

// P4: once a flow page begins, photobook fields are body text, kept verbatim
const FOCUS_IN_FLOW = PHOTO_HEAD + 'kind: flow\nfocus: 50% 38%\nBody';
const fif = parseBook(FOCUS_IN_FLOW).chapters[0].pages[0];
eq([fif.kind, fif.focus, fif.caption], ['flow', '', 'focus: 50% 38%\nBody'], 'P4: a focus line in a flow body stays body text');
eq(parseBook(PHOTO_HEAD + 'kind: flow\nkind: mat\nBody').chapters[0].pages[0].caption, 'kind: mat\nBody',
  'P4: a kind line in a flow body stays body text');

// P2: a combining sequence is never split across lines/pages, nor attached to another character
const TIGHT = { width: 5.5, height: 10, fontSize: 10, lineHeight: 1, paragraphGap: 0 };
const acc = 'éé';
eq(lineTexts(acc, layoutFlow(acc, TIGHT)), ['é', 'é'], 'P2: e + combining acute stays one glyph per line');
const kana = 'がが';
eq(lineTexts(kana, layoutFlow(kana, { ...TIGHT, width: 10 })), ['が', 'が'], 'P2: decomposed dakuten stays with its kana');
const nonMarks = (s) => [...s].filter((c) => !/^\p{M}$/u.test(c)).length;
const mixed = 'a中́b';
eq(lineTexts(mixed, layoutFlow(mixed, { width: 2, height: 1, fontSize: 1, lineHeight: 1, paragraphGap: 0, measure: nonMarks })),
  ['a中́', 'b'], 'P2: a mark on a CJK base does not move to the next latin word');
eq(defaultMeasure('é', 10), defaultMeasure('e', 10), 'P2: a combining mark has no width of its own');

// P3: CRLF is one hard break with no glyph width; LF and CRLF documents paginate the same
const DIM = { width: 22, height: 10, fontSize: 10, lineHeight: 1, paragraphGap: 0 };
const lfLay = layoutFlow('abcd\nefgh', DIM), crlfLay = layoutFlow('abcd\r\nefgh', DIM);
eq(lineTexts('abcd\r\nefgh', crlfLay), ['abcd\r\n', 'efgh'], 'P3: CRLF ends the line and both units stay in its range');
eq(crlfLay.pages.length, lfLay.pages.length, 'P3: CRLF gives as many pages as LF');
const lfDoc = 'Para one is here.\nIt has a second line.\n\nPara two.\n';
const crlfDoc = lfDoc.replace(/\n/g, '\r\n');
const lfBig = layoutFlow(lfDoc, { width: 60, height: 40, fontSize: 10 }), crlfBig = layoutFlow(crlfDoc, { width: 60, height: 40, fontSize: 10 });
eq(crlfBig.lines.map((l) => l.width), lfBig.lines.map((l) => l.width), 'P3: CRLF lines measure the same as LF lines');
eq(crlfBig.pages.length, lfBig.pages.length, 'P3: an LF document and its CRLF twin paginate identically');

// P5: supplementary-plane CJK (Extension B+) breaks per glyph, without splitting a surrogate pair
const astral = 'a \u{20000}\u{20001}';
const codepoints = (s) => [...s].length;
eq(lineTexts(astral, layoutFlow(astral, { ...DIM, width: 3, measure: codepoints })), ['a \u{20000}', '\u{20001}'],
  'P5: an Extension B ideograph fits beside latin and the next one wraps alone');
ok(defaultMeasure('\u{20000}', 16) === defaultMeasure('中', 16), 'P5: the default measure sets Extension B as wide as BMP CJK');

console.log(`\npagetile flow: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
