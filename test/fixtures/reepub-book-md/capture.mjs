#!/usr/bin/env node
// capture.mjs — vendor reepub's book-md fixtures at a pinned commit and record what REEPUB'S parser
// says about the overlap. Run by hand when re-pinning; never at test time (no network, no checkout).
//
//   node test/fixtures/reepub-book-md/capture.mjs <path to a clean CVERInc/reepub checkout>
//
// It writes, next to itself: the fixture files (byte for byte), reepub's LICENSE, and expected.json.
// expected.json is the gate's answer key (test/book-overlap.test.mjs). It is computed with reepub's
// own ledger-side parser, `parseBookJS` in scripts/check-book-format.mjs, lifted verbatim — never with
// tile's book-core, because an answer key a parser writes for itself can only ever agree with it.
//
// The projection from reepub's output onto the overlap is the only code here that is ours:
//   - direction        = the frontmatter `direction` reepub's parser read
//   - chapters         = the titles of its level-1 sections, in source order
//   - kind             = `fixed` when the frontmatter says `kind: fixed`, else `flow` (reepub's default)
//   - fixedPages       = (fixed books only) per chapter, per level-2 section after it, the images as
//                        [src, alt|null] in order. A shape this rule cannot place (a page before the
//                        first chapter, a level-3 section, an image outside a page) stops the capture
//                        instead of being guessed at.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const checkout = process.argv[2];
if (!checkout) { console.error('usage: node capture.mjs <reepub checkout>'); process.exit(2); }

const SCRIPT = 'scripts/check-book-format.mjs';
const CORPUS = 'fixtures/book-md';
const git = (...a) => execFileSync('git', ['-C', checkout, ...a], { encoding: 'utf8' }).trim();
const sha = git('rev-parse', 'HEAD');
if (git('status', '--porcelain', '--', CORPUS, SCRIPT, 'LICENSE')) {
  console.error(`✗ ${CORPUS}, ${SCRIPT} or LICENSE has local changes; capture from a clean commit`);
  process.exit(1);
}

// Lift two functions out of the check script without running its main body.
const src = fs.readFileSync(path.join(checkout, SCRIPT), 'utf8');
const lift = (name, endMarker) => {
  const start = src.indexOf(`function ${name}(`);
  const end = src.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`cannot find ${name} in ${SCRIPT} at ${sha}; the lift needs updating`);
  return new Function(src.slice(start, end) + `\nreturn ${name};`)();
};
const parseBookJS = lift('parseBookJS', '\nfunction crossParser(');
const frontmatter = lift('frontmatter', '\n// Headings that are inside a fenced block');

const files = fs.readdirSync(path.join(checkout, CORPUS)).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
for (const f of fs.readdirSync(HERE).filter((f) => f.endsWith('.md') && f !== 'README.md')) fs.rmSync(path.join(HERE, f));

const books = {};
for (const file of files) {
  const bytes = fs.readFileSync(path.join(checkout, CORPUS, file));
  fs.writeFileSync(path.join(HERE, file), bytes);
  const text = bytes.toString('utf8');
  const r = parseBookJS(text);
  const kind = (frontmatter(text) || {}).kind === 'fixed' ? 'fixed' : 'flow';
  const book = {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    direction: r.direction,
    kind,
    chapters: r.chapters.filter((c) => c.level === 1).map((c) => c.title),
  };
  if (kind === 'fixed') {
    const stop = (why) => { throw new Error(`${file}: ${why} — the fixed-page projection has no rule for this`); };
    if (r.preamble.images.length) stop('an image before the first chapter');
    book.fixedPages = [];
    for (const s of r.chapters) {
      if (s.level === 1) { if (s.images.length) stop('an image outside a page'); book.fixedPages.push([]); }
      else if (s.level === 2) {
        if (!book.fixedPages.length) stop('a page before the first chapter');
        book.fixedPages[book.fixedPages.length - 1].push(s.images.map((i) => [i.href, i.alt ?? null]));
      } else stop(`a level-${s.level} section`);
    }
  }
  books[file] = book;
}

fs.copyFileSync(path.join(checkout, 'LICENSE'), path.join(HERE, 'LICENSE'));
const out = { source: { repo: 'CVERInc/reepub', sha, parser: `${SCRIPT}#parseBookJS`, licence: 'MIT' }, books };
fs.writeFileSync(path.join(HERE, 'expected.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`captured ${files.length} fixtures at ${sha}`);
