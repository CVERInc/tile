#!/usr/bin/env node
// pagetile `.book.md` vs reepub book-md: the overlap gate (reef#2278). Pure Node, no npm, no network.
//
// Two parsers read "a pagetile book": packages/pagetile/book-core.js here, and reepub's (a Swift
// converter, with a JavaScript twin in its scripts/check-book-format.mjs). They were meant to read
// one format. They do not: they agree on part of it and differ on the rest. This test holds the part
// they agree on, so it cannot drift further while the rest waits to be unified.
//
// GATED — compared over reepub's own fixture corpus, vendored at a pinned commit in
// test/fixtures/reepub-book-md/ (see its README for the source, the commit and the licence):
//   1. chapter count            (`#` headings; empty chapters; `#` inside a fence or a blockquote is not one)
//   2. chapter order            (the chapter titles, in source order)
//   3. reading direction        (frontmatter `direction`, carried through)
//   4. plate pages of `kind: fixed` books   (per chapter, per page, the images as [src, alt] in order)
//
// The expected values are NOT computed by book-core. They are reepub's parser output, captured once at
// the pin into expected.json by capture.mjs beside the fixtures. A key written by the parser under
// test could only ever agree with it.
//
// NOT GATED — the known divergence, an accident to be removed by moving both sides to one simpler
// format (reef#2278, destination "a"). Listed so nobody reads a green run as covering them:
//   - prose under a `#` with no `##`: chapter text for reepub; dropped by book-core (no page holds it)
//   - `##`: always a page here; in reepub a page only in a `kind: fixed` book, a sub-heading otherwise
//   - flow vs fixed: reepub marks the BOOK (frontmatter `kind: fixed`, default flow); book-core marks
//     each PAGE (`kind: flow` under `##`, default fixed) and ignores the frontmatter key
//   - images in flow text: reepub lists every embed line; book-core keeps only a fixed page's
//   - preamble before the first `#`: data for reepub; dropped by book-core
//   - `###` and deeper: a section for reepub; caption text here
//
// The last block proves each compared field can go red: it breaks one field at a time in book-core's
// output and requires the comparison to name that field and only that field.
//
// Run: node test/book-overlap.test.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBook } from '../packages/pagetile/book-core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, 'fixtures', 'reepub-book-md');
const EXPECTED = JSON.parse(fs.readFileSync(path.join(DIR, 'expected.json'), 'utf8'));

let pass = 0, fail = 0;
const eq = (a, b, msg) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (ok) pass++; else { fail++; console.error('FAIL:', msg, '\n  got:', JSON.stringify(a), '\n  exp:', JSON.stringify(b)); } };
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL:', msg); } };

// book-core's model, projected onto the overlap. `kind` comes from the answer key (reepub's rule),
// because book-core has no book-level kind to ask.
function overlapOf(book, kind) {
  const out = { direction: book.meta.direction, chapters: book.chapters.map((c) => c.title) };
  if (kind === 'fixed') out.fixedPages = book.chapters.map((c) => c.pages.map((p) => p.images.map((i) => [i.src, i.alt || null])));
  return out;
}

// The comparison, by field. Returns the names of the fields that differ.
function differences(exp, got) {
  const d = [];
  if (exp.chapters.length !== got.chapters.length) d.push('chapter count');
  if (JSON.stringify(exp.chapters) !== JSON.stringify(got.chapters)) d.push('chapter order');
  if (exp.direction !== got.direction) d.push('direction');
  if (exp.kind === 'fixed' && JSON.stringify(exp.fixedPages) !== JSON.stringify(got.fixedPages)) d.push('fixed pages');
  return d;
}

// ── the vendored corpus is the one the key was captured from ──────────────────────────────
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
eq(files, Object.keys(EXPECTED.books).sort(), 'the vendored fixtures and expected.json name the same books');
for (const f of files) {
  const sum = crypto.createHash('sha256').update(fs.readFileSync(path.join(DIR, f))).digest('hex');
  eq(sum, EXPECTED.books[f]?.sha256, `${f} is byte-identical to the capture (re-run capture.mjs to move the pin, never edit by hand)`);
}
// A gate with nothing to compare passes. Each compared field must have a fixture that exercises it.
ok(files.length > 0, 'the corpus is not empty');
ok(Object.values(EXPECTED.books).some((b) => b.kind === 'fixed' && b.fixedPages.flat(2).length > 0), 'at least one `kind: fixed` book with images (else the plate-page check is vacuous)');
ok(Object.values(EXPECTED.books).some((b) => b.direction === 'rtl'), 'at least one rtl book (else the direction check cannot tell rtl from a default)');
ok(Object.values(EXPECTED.books).some((b) => b.chapters.length > 1), 'at least one book with several chapters (else order is untested)');

// ── the gate ─────────────────────────────────────────────────────────────────────────────
const actual = {};
for (const f of files) {
  const exp = EXPECTED.books[f];
  actual[f] = parseBook(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const got = overlapOf(actual[f], exp.kind);
  const d = differences(exp, got);
  eq(d, [], `${f}: book-core agrees with reepub on the overlap` + (d.length ? ` — differs on ${d.join(', ')}; expected ${JSON.stringify(exp)}, book-core ${JSON.stringify(got)}` : ''));
}

// ── the gate can fail: break one field at a time, require it named alone ─────────────────────
const clone = (x) => JSON.parse(JSON.stringify(x));
const mutations = [
  ['chapter count', 'empty-chapter.md', (b) => { b.chapters.splice(1, 1); }],   // a dropped (empty) chapter
  ['chapter order', 'ltr-prose-only.md', (b) => { b.chapters.reverse(); }],
  ['direction', 'plates-only.md', (b) => { b.meta.direction = 'ltr'; }],
  ['fixed pages', 'plates-only.md', (b) => { const p = b.chapters[0].pages; [p[0].images, p[1].images] = [p[1].images, p[0].images]; }],
];
for (const [field, f, mutate] of mutations) {
  const exp = EXPECTED.books[f];
  const b = clone(actual[f]);
  mutate(b);
  const d = differences(exp, overlapOf(b, exp.kind));
  ok(d.includes(field), `mutation of ${field} on ${f} turns the gate red (got ${JSON.stringify(d)})`);
  // a count change also changes the title list; every other mutation must name its own field only
  const allowed = field === 'chapter count' ? ['chapter count', 'chapter order'] : [field];
  ok(d.every((x) => allowed.includes(x)), `mutation of ${field} on ${f} is reported as ${field}, not as another field (got ${JSON.stringify(d)})`);
}

console.log(`\nbook overlap (pagetile vs reepub @ ${EXPECTED.source.sha.slice(0, 7)}): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
