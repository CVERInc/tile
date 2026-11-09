#!/usr/bin/env node
// pagetile flow page — a flow body survives a save verbatim (tile#274 round 2 review).
//
// A flow page's body is the author's text, and its blank lines are part of it (a run of three
// newlines, blank lines inside a fenced code block). serializeBook's whitespace normalisation (runs
// of 3+ newlines → 2, trailing whitespace trimmed) is for the FIXED page vocabulary and must keep
// producing exactly the output it always has there — but it must not touch a flow body.
//
// Each check compares the ORIGINAL caption with the caption read back after one save — not only
// that a second save matches the first (a save that loses text the same way twice is idempotent).
//
// Run: node test/pagetile-flow-roundtrip.test.mjs
import { parseBook, serializeBook } from '../packages/pagetile/book-core.js';

let pass = 0, fail = 0;
const eq = (a, b, msg) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error('FAIL:', msg, '\n  got:', JSON.stringify(a), '\n  exp:', JSON.stringify(b)); }
};
const pages = (book) => book.chapters.flatMap((c) => c.pages);
const saved = (book) => parseBook(serializeBook(book));

// ── a flow body round-trips verbatim ────────────────────────────────────────────────────────
// the reviewer's two inputs first, then the shapes around them
const BODIES = [
  ['three newlines between paragraphs', 'A\n\n\nB'],
  ['blank lines inside a fenced code block', '```text\nfirst\n\n\nlast\n```'],
  ['a long run of blank lines', 'A\n\n\n\n\n\nB'],
  ['whitespace-only lines between paragraphs', 'A\n  \n\t\n\nB'],
  ['trailing spaces on the last line', 'A\n\n\nB  '],
  ['CRLF blank lines', 'A\r\n\r\n\r\nB'],
  ['a tilde fence with blank lines and an image line', '~~~\nx\n\n\n~~~\n\n\n![[a.png]]'],
];
for (const [name, body] of BODIES) {
  for (const [where, raw] of [
    ['alone', '# C\n## P\nkind: flow\n' + body + '\n'],
    ['last page of the book', '# C\n## Cover\n![[c.png]]\n\n## P\nkind: flow\n' + body],
    ['between fixed pages', '# C\n## Cover\n![[c.png]]\n\n## P\nkind: flow\n' + body + '\n\n\n\n## Next\n![[n.png]]\n# D\n## Last\ntext\n'],
  ]) {
    const flow = pages(parseBook(raw)).find((p) => p.kind === 'flow');
    eq(flow.caption, body, name + ' (' + where + '): the parse keeps the body');
    eq(pages(saved(parseBook(raw))).find((p) => p.kind === 'flow').caption, body, name + ' (' + where + '): the original body survives a save');
    eq(serializeBook(saved(parseBook(raw))), serializeBook(parseBook(raw)), name + ' (' + where + '): a second save changes nothing');
  }
}
// a photobook flow page too (its page has kind/focus keys of its own)
const PHOTO_FLOW = '---\npagetile-book: true\nsource: photobook\n---\n# C\n## P\nkind: flow\nA\n\n\nB\n## Q\nkind: mat\n![[q.jpg]]\n';
eq(pages(saved(parseBook(PHOTO_FLOW)))[0].caption, 'A\n\n\nB', 'photobook flow page: the original body survives a save');
eq(pages(saved(parseBook(PHOTO_FLOW)))[1], pages(parseBook(PHOTO_FLOW))[1], 'photobook flow page: the fixed page after it is unchanged');

// ── fixed pages keep their normalisation, byte for byte ─────────────────────────────────────
// (expected strings are the serializer's output before flow pages existed)
const COMIC = '---\npagetile-book: true\n---\n# C\n## P1\n![[a.png]]\nline one\n\n\n\nline two   \n## P2\n```\nx\n\n\ny\n```\n';
eq(serializeBook(parseBook(COMIC)),
  '---\npagetile-book: true\n---\n\n# C\n\n## P1\n![[a.png]]\nline one\n\nline two   \n\n## P2\n```\nx\n\ny\n```\n',
  'a comic still collapses 3+ newlines (also inside a fence) exactly as before');
const PHOTO = '---\npagetile-book: true\nsource: photobook\n---\n# C\n## P\nfocus: 50% 38%\nkind: flow\n![[photo.jpg]]\n\n\n\nend  \n';
eq(serializeBook(parseBook(PHOTO)),
  '---\npagetile-book: true\nsource: photobook\n---\n\n# C\n\n## P\nfocus: 50% 38%\n![[photo.jpg]]\nkind: flow\n\nend\n',
  'a photobook page with a late `kind: flow` serializes exactly as before');
// a caption that happens to contain any marker text the serializer might use is still just text
const ODD = '# C\n## P\n\u0000\u0000flow\u0000\nkind: flow\n## Q\nkind: flow\nA\n\n\nB\n';
eq(pages(saved(parseBook(ODD))).map((p) => p.caption), ['\u0000\u0000flow\u0000\nkind: flow', 'A\n\n\nB'],
  'NUL characters in a fixed caption do not disturb the flow body beside it');

const ODD_TITLE = '# C\n## \u00000\u0000 and \u0000\u00000\u0000\u0000\nkind: flow\nA\n\n\nB\n';
const oddTitle = pages(saved(parseBook(ODD_TITLE)))[0];
eq([oddTitle.title, oddTitle.caption], ['\u00000\u0000 and \u0000\u00000\u0000\u0000', 'A\n\n\nB'],
  'NUL characters in a page title are neither replaced nor disturb the flow body');

console.log(`\npagetile flow round-trip: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
