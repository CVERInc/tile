// REEF with Pagetile — sitetile-side render helpers for a paged comic/book.
// Reuses the family's book-core.js model VERBATIM (parse/serialize/flatten — the same
// engine pagetile-w's authoring editor uses). This file adds ONLY the read-only reader
// projection (prev/next, chapter table of contents, image URL resolution) — it does NOT
// reimplement parsing, per the family rule (one model, every surface consumes it).
import { parseBook, flattenPages } from '../../../../../pagetile-w/book-core.js';

// A pagetile image src is repo-relative (`pagetile/ch1/p01.jpg`, matching the family's
// `![[name]]` convention). The reader serves it from /pagetile/... in public/ (staged there
// by build-deploy-sitetile.sh --assets, alongside the book.md staged separately by --pagetile
// into astro/pagetile/ — the book file itself is never served, only its image references are).
function toPublicSrc(src) {
  const s = String(src || '').replace(/^\/+/, '');
  return '/' + s;
}

// loadBook: raw book markdown (glob-imported) → { book, flat, chapters }.
//   flat      = [{ id, title, chapterTitle, chapterId, index, imageSrc, caption, prev, next }]
//   chapters  = [{ id, title, firstPageId, pageCount }]   (table of contents for /preview index)
export function loadBook(raw) {
  const book = parseBook(String(raw || ''));
  const rawFlat = flattenPages(book);
  const flat = rawFlat.map((entry, i) => {
    const page = entry.page;
    const lead = page.images && page.images[0];
    const chPages = entry.chapter.pages;
    const nextLead = rawFlat[i + 1] && rawFlat[i + 1].page.images && rawFlat[i + 1].page.images[0];
    return {
      id: page.id,
      title: page.title || `Page ${i + 1}`,
      chapterId: entry.chapter.id,
      chapterTitle: entry.chapter.title,
      index: i,
      // per-chapter position for the reader's "3 / 21" counter
      pageInChapter: chPages.indexOf(page) + 1,
      chapterPageCount: chPages.length,
      imageSrc: lead ? toPublicSrc(lead.src) : '',
      // the NEXT page's image, for a <link rel="prefetch"> so page-turns feel instant
      nextImageSrc: nextLead ? toPublicSrc(nextLead.src) : '',
      caption: page.caption || '',
      prev: rawFlat[i - 1] ? rawFlat[i - 1].page.id : null,
      next: rawFlat[i + 1] ? rawFlat[i + 1].page.id : null,
    };
  });
  const chapters = (book.chapters || []).map((c) => {
    const firstLead = c.pages[0] && c.pages[0].images && c.pages[0].images[0];
    return {
      id: c.id,
      title: c.title,
      firstPageId: c.pages[0] ? c.pages[0].id : null,
      pageCount: c.pages.length,
      // first page's image doubles as the chapter-card thumbnail on /preview
      coverSrc: firstLead ? toPublicSrc(firstLead.src) : '',
    };
  });
  return { title: book.title, flat, chapters };
}

// loadFirstBook: convenience for the common case (one site = one book). `glob` is the
// import.meta.glob() result from the calling .astro page (kept as a param so this stays a
// plain testable function, no import.meta usage inside a .mjs).
export function loadFirstBook(glob) {
  const entries = Object.values(glob);
  if (!entries.length) return null;
  return loadBook(entries[0]);
}

// ── pagetile reader v2 (Kindle-grade, per-chapter) ───────────────────────────
// loadReaderBook: raw book markdown → everything the per-chapter reader route needs.
// Unlike loadBook (per-page), this groups by chapter and carries the book-level reading
// mode + direction (frontmatter), plus GLOBAL page indices so the reader can show overall
// "page N / total · X%". The reader loads one chapter's full page list into the DOM and
// switches paged⇄scroll client-side.
//   { title, direction: 'ltr'|'rtl', mode: 'paged'|'scroll', totalPages,
//     chapters: [{ id, title, index, pageCount, startGlobalIndex, coverSrc,
//                  pages: [{ id, pageInChapter, globalIndex, imageSrc, caption }] }] }
// A book's one-line blurb, with at most ONE inline `[label](href)` — split into the three pieces a
// template can render without ever handing raw markup to the page.
//
// The first shape of this took a separate `link-label`/`link-href` pair, which could only ever put
// the link at the END of the line. That is not a style limitation, it is a sentence the author
// cannot write: "New chapters land on Patreon first." has words on BOTH sides of the link. A data
// model that quietly rewrites someone's sentence is the same defect as hardcoding it, one step
// further from where anyone would look for it.
//
// Deliberately one link and no other markdown: this is a single line of chrome, not prose. `href`
// is restricted to http(s), a site-root path, or a fragment — the blurb comes from a file the site
// owner controls, but `javascript:` in a link the RENDERER emits is our failure, not theirs.
export function parseBlurb(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const m = /^([\s\S]*?)\[([^\]]+)\]\(([^)\s]+)\)([\s\S]*)$/.exec(text);
  if (!m) return { before: text, link: null, after: '' };
  const href = m[3];
  const safe = /^(https?:\/\/|\/|#)/i.test(href);
  if (!safe) return { before: text, link: null, after: '' };
  return { before: m[1], link: { label: m[2], href }, after: m[4] };
}

export function loadReaderBook(raw) {
  const book = parseBook(String(raw || ''));
  const meta = book.meta || {};
  const direction = String(meta.direction || 'ltr').trim().toLowerCase() === 'rtl' ? 'rtl' : 'ltr';
  const mode = String(meta.mode || 'paged').trim().toLowerCase() === 'scroll' ? 'scroll' : 'paged';
  // What the preview landing says about this book, declared BY the book. The renderer supplies the
  // interstitial and the chapter list; it must not supply the words. A content notice is the
  // clearest case: whether a book needs one, and what it should say, is the author's call about
  // their own work and their own jurisdiction — an engine that ships a default has decided both.
  // Absent `notice` means no interstitial at all, not an empty one.
  const notice = String(meta.notice || '').trim();
  const blurb = parseBlurb(meta.blurb);
  let g = 0;
  const chapters = (book.chapters || []).map((c, ci) => {
    const startGlobalIndex = g;
    const pages = (c.pages || []).map((p, pi) => {
      const lead = p.images && p.images[0];
      const imageSrc = lead ? toPublicSrc(lead.src) : '';
      const entry = {
        id: p.id,
        pageInChapter: pi + 1,
        globalIndex: g,
        imageSrc,
        // downscaled scrubber thumbnail: `/pagetile/…` → `/pagetile-thumbs/…` (built alongside the
        // assets by the site's thumb step; if absent the scrubber simply shows no image).
        thumbSrc: imageSrc.replace(/^\/pagetile\//, '/pagetile-thumbs/'),
        caption: p.caption || '',
      };
      g += 1;
      return entry;
    });
    const firstLead = c.pages[0] && c.pages[0].images && c.pages[0].images[0];
    return {
      id: c.id,
      title: c.title,
      index: ci,
      pageCount: pages.length,
      startGlobalIndex,
      coverSrc: firstLead ? toPublicSrc(firstLead.src) : '',
      pages,
    };
  });
  return { title: book.title, direction, mode, totalPages: g, chapters, notice, blurb };
}

// loadFirstReaderBook: the one-site-one-book convenience, mirroring loadFirstBook.
export function loadFirstReaderBook(glob) {
  const entries = Object.values(glob);
  if (!entries.length) return null;
  return loadReaderBook(entries[0]);
}
