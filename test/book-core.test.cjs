#!/usr/bin/env node
/* pagetile book-core Unit Tests (pure Node, no npm) — same approach as the family's core tests:
 * load the ES-module model by stripping its `export {…}` and eval'ing in a CommonMess sandbox.
 *
 * Tests: round-trip (parse → serialize → parse is stable), reading-order flatten, image-embed
 * round-trip (wikilink + markdown forms preserved), deep-link ids, frontmatter detection.
 *
 * Run: node test/book-core.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'pagetile-w', 'book-core.js'), 'utf8')
  .replace(/export\s*\{[\s\S]*?\};?\s*$/, '');   // drop the ESM export footer; functions become module-local
const sandbox = {};
new Function('module', 'exports', src + '\nObject.assign(module.exports, { parseBook, serializeBook, isBookFile, flattenPages, pageById, allImageSrcs });')(
  { exports: sandbox }, sandbox);
const { parseBook, serializeBook, isBookFile, flattenPages, pageById, allImageSrcs } = sandbox;

let pass = 0, fail = 0;
const eq = (a, b, msg) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (ok) pass++; else { fail++; console.error('FAIL:', msg, '\n  got:', JSON.stringify(a), '\n  exp:', JSON.stringify(b)); } };
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL:', msg); } };

const BOOK = [
  '---', 'pagetile-book: true', 'title: 長得要命の新婚旅行', '---', '',
  '# Chapter 1 · 出発', '', '## Page 1', '![[cover.png]]', 'The honeymoon begins.', '',
  '## Page 2', '![alt text](p002.png)', '', '# Chapter 2', '', '## Page 1', '![[p003.png|早朝]]', 'A quiet morning.', '',
].join('\n');

const b = parseBook(BOOK);

// structure
eq(b.title, '長得要命の新婚旅行', 'title from frontmatter');
eq(b.chapters.length, 2, 'two chapters');
eq(b.chapters[0].pages.length, 2, 'chapter 1 has two pages');
eq(b.chapters[1].pages.length, 1, 'chapter 2 has one page');

// images: both embed forms parsed + classified
eq(b.chapters[0].pages[0].images, [{ src: 'cover.png', alt: '', embed: 'wikilink' }], 'wikilink image');
eq(b.chapters[0].pages[1].images, [{ src: 'p002.png', alt: 'alt text', embed: 'markdown' }], 'markdown image w/ alt');
eq(b.chapters[1].pages[0].images, [{ src: 'p003.png', alt: '早朝', embed: 'wikilink' }], 'wikilink image w/ pipe alt');

// captions are raw markdown (what the shared editor edits)
eq(b.chapters[0].pages[0].caption, 'The honeymoon begins.', 'page caption captured');

// reading order
const flat = flattenPages(b);
eq(flat.length, 3, 'three pages in reading order');
eq(flat.map((e) => e.page.id), ['c1-chapter-1-出発-p1', 'c1-chapter-1-出発-p2', 'c2-chapter-2-p1'], 'stable ids, slug from title, ordered');
eq(flat.map((e) => e.index), [0, 1, 2], 'flat indices sequential');
eq(pageById(b, 'c1-chapter-1-出発-p2'), 1, 'deep-link id resolves to flat index');
eq(pageById(b, 'nope'), -1, 'missing id → -1');

// asset list (for the CF Pages deploy step)
eq(allImageSrcs(b), ['cover.png', 'p002.png', 'p003.png'], 'all image srcs in reading order');

// frontmatter detection
ok(isBookFile(BOOK), 'isBookFile true for a book');
ok(!isBookFile('# just a note\n\nhello'), 'isBookFile false for a plain note');

// round-trip stability: parse → serialize → parse → serialize is idempotent
const md1 = serializeBook(b);
const md2 = serializeBook(parseBook(md1));
eq(md2, md1, 'serialize is idempotent across a re-parse');
const b2 = parseBook(md1);
eq(b2.chapters.length, b.chapters.length, 'round-trip preserves chapter count');
eq(allImageSrcs(b2), allImageSrcs(b), 'round-trip preserves images + order');

console.log(`\npagetile book-core: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
