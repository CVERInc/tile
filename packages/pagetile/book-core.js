// pagetile — paged/e-book content model (platform-free, no Obsidian, no DOM).
//
// The tile family's 4th content essence: PAGED. Card = one page, Blog = flowing posts,
// Site = source — and pagetile = chapters → pages → images, read in sequence. It is the
// AUTHORING model for paged-content Sites (comics / manga / picture-books / e-books), e.g.
// a Site that deploys to Cloudflare Pages.
//
// Same trick as packages/tugtile/board-core.js: ONE model, parsed/serialized here, consumed by
// every surface. The model is PURE (parse/serialize round-trip, no side effects) so it is
// unit-testable in plain Node — the family discipline. The shared EDITOR engine
// (packages/core/editor-core.js → mountEditor/equipEditor) is reused verbatim for editing a
// page's CAPTION/markdown; this file owns only the paged STRUCTURE the editor doesn't.
//
// ── Storage format (the on-disk truth) ───────────────────────────────────────────────────
// A book is a single Markdown file, human-readable and diff-friendly (the family's "your data
// stays Markdown, not a database" rule). Frontmatter marks it as a pagetile book; `# ` H1
// headings open chapters; `## ` H2 headings open pages; an image embed line places an image on
// the current page; ordinary markdown lines are the page's caption/notes. Reading order = source
// order (chapters top→bottom, pages within a chapter top→bottom). This mirrors tugtile's
// "lanes are ## headings, cards are - [ ] items" — pagetile is the SAME idea one essence over.
//
//   ---
//   pagetile-book: true
//   title: 長得要命的新婚旅行
//   ---
//
//   # Chapter 1 · 出発
//
//   ## Page 1
//   ![[cover.png]]
//   The honeymoon begins.
//
//   ## Page 2
//   ![[p002.png]]
//
// Image embeds accepted (so it round-trips with Obsidian + the web alike, like the editor's
// canonical ![[…]]): `![[name]]` (Obsidian wikilink) and `![alt](src)` (CommonMark). A page may
// hold zero or many images; the first image is the page's lead (cover/thumbnail candidate).
//
// ── Photobook source (reef docs/SPEC-pagetile-photobook-source.md) ─────────────────────────
// A comic or PDF page IS its image. A photobook page is COMPOSED at view time from a photo, a
// layout kind and a focus point, so it needs words the fixed source never had. A book opts in
// with `source: photobook` in its frontmatter, and its pages may then open with two lines:
//
//   ## Harbour
//   kind: full          # full = full-bleed (cropped to the page);  mat = the whole photo on a mat
//   focus: 50% 38%      # the point a crop keeps; default the centre
//   ![[harbour.jpg]]
//
// Both are optional and the absent kind is NOT a third value: the reader decides it from the
// photo's own shape (portrait → mat, landscape → full — `defaultKind`), which is the spec's "make
// the taste the default". They are read only before the page's first caption line, and only in a
// photobook: in every other book they are ordinary caption text, so a comic's model is exactly
// what it was before this vocabulary existed. The spec's other two kinds (`duo`, `text`) and the
// cover/back pages are not here yet — `kind: duo` stays caption text rather than being guessed at.

const FRONTMATTER_KEY = 'pagetile-book';
const PHOTOBOOK_SOURCE = 'photobook';
const LAYOUT_KINDS = ['full', 'mat'];
const DEFAULT_FOCUS = '50% 50%';

// ── Model shape (what parseBook returns / serializeBook consumes) ─────────────────────────
//
//   Book    = { title, meta, chapters: [Chapter] }
//   Chapter = { id, title, pages: [Page] }
//   Page    = { id, title, images: [Image], caption }   // caption = the page's markdown body
//             + { kind, focus } in a photobook only     // '' = not declared (see resolveLayout)
//   Image   = { src, alt, embed }                       // embed: 'wikilink' | 'markdown'
//
// `id` is a stable slug derived from order+title (chapter index, page index) so a reader/preview
// can deep-link a page (#c1-p2) without the title leaking into the URL. `caption` is RAW markdown
// — it is exactly what the shared editor (mountEditor) edits, so the editor needs zero changes.

function slugify(s, fallback) {
  const out = String(s == null ? '' : s).toLowerCase().trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return out || fallback;
}

const RE_FENCE = /^\s*(```|~~~)/;
const RE_IMG_WIKI = /^!\[\[([^\]]+?)\]\]\s*$/;                 // ![[name]] (optional |alt after a pipe inside)
const RE_IMG_MD = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/;  // ![alt](src "title")

// Parse one image-embed line into { src, alt, embed } or null if the line isn't a standalone embed.
function parseImageLine(line) {
  let m = RE_IMG_WIKI.exec(line);
  if (m) { const parts = m[1].split('|'); return { src: parts[0].trim(), alt: (parts[1] || '').trim(), embed: 'wikilink' }; }
  m = RE_IMG_MD.exec(line);
  if (m) return { src: m[2].trim(), alt: (m[1] || '').trim(), embed: 'markdown' };
  return null;
}

// Serialize one image back to the EXACT embed form it came in as (round-trip fidelity, the family rule).
function serializeImage(img) {
  if (img.embed === 'markdown') return '![' + (img.alt || '') + '](' + img.src + ')';
  return '![[' + img.src + (img.alt ? '|' + img.alt : '') + ']]';
}

// parseFocus: "50% 38%" (quotes allowed, as the spec writes it in YAML) → normalized "50% 38%", or
// '' if it isn't two percentages in 0–100. The value reaches a style attribute, so anything that
// is not exactly this shape is refused rather than passed through.
function parseFocus(value) {
  const m = /^\s*["']?\s*(\d{1,3}(?:\.\d+)?)%\s+(\d{1,3}(?:\.\d+)?)%\s*["']?\s*$/.exec(String(value == null ? '' : value));
  if (!m) return '';
  const x = Number(m[1]), y = Number(m[2]);
  if (x > 100 || y > 100) return '';
  return x + '% ' + y + '%';
}

// parseLayoutLine: one photobook page-head line → { kind } | { focus } | null. A line with the right
// key but a value outside the vocabulary is null (it stays caption text, visible, not swallowed).
function parseLayoutLine(line) {
  const m = /^(kind|focus):\s*(.*?)\s*$/.exec(line);
  if (!m) return null;
  if (m[1] === 'kind') return LAYOUT_KINDS.includes(m[2]) ? { kind: m[2] } : null;
  const focus = parseFocus(m[2]);
  return focus ? { focus } : null;
}

// Split a raw file into { meta, body } — a minimal frontmatter reader (key: value pairs only; the
// family avoids a YAML dependency, same as tugtile's frontmatter handling).
function splitFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  m[1].split('\n').forEach((line) => {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  });
  return { meta, body: text.slice(m[0].length) };
}

// parseBook: raw Markdown → Book model. Pure. Code fences are respected so a ## inside a fenced
// block is NOT mistaken for a page break (same guard as the editor's tocHeadings).
function parseBook(text) {
  const { meta, body } = splitFrontmatter(String(text || ''));
  const photobook = meta.source === PHOTOBOOK_SOURCE;
  const lines = body.split('\n');
  const chapters = [];
  let chapter = null, page = null, fence = false;
  let captionBuf = [];
  // the page head: layout lines are read only until the caption has said something
  const inPageHead = () => !captionBuf.some((l) => l.trim() !== '');

  const flushCaption = () => {
    if (page) page.caption = captionBuf.join('\n').replace(/\n+$/,'').replace(/^\n+/,'');
    captionBuf = [];
  };
  const newChapter = (title) => { flushCaption(); page = null;
    chapter = { id: '', title: title, pages: [] }; chapters.push(chapter); };
  const newPage = (title) => { flushCaption();
    if (!chapter) newChapter('');   // a page before any chapter → an implicit untitled chapter
    page = { id: '', title: title, images: [], caption: '' };
    if (photobook) { page.kind = ''; page.focus = ''; }
    chapter.pages.push(page); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (RE_FENCE.test(line)) { fence = !fence; if (page) captionBuf.push(line); continue; }
    if (!fence) {
      const hc = /^#\s+(.*)$/.exec(line);   if (hc) { newChapter(hc[1].trim()); continue; }
      const hp = /^##\s+(.*)$/.exec(line);  if (hp) { newPage(hp[1].trim()); continue; }
      const img = parseImageLine(line);     if (img && page) { page.images.push(img); continue; }
      if (photobook && page && inPageHead()) {
        // a key the page already has is not read twice — the repeat stays caption, so nothing is lost
        const lay = parseLayoutLine(line);
        if (lay && !page[Object.keys(lay)[0]]) { Object.assign(page, lay); continue; }
      }
    }
    if (page) captionBuf.push(line);
    // lines before the first page (and not a heading) are book-level preamble → dropped on
    // re-serialize; authoring keeps everything under a page, so this is a non-issue in practice.
  }
  flushCaption();

  // assign stable ids by order
  chapters.forEach((c, ci) => {
    c.id = 'c' + (ci + 1) + (c.title ? '-' + slugify(c.title, '') : '');
    c.pages.forEach((p, pi) => { p.id = c.id + '-p' + (pi + 1); });
  });

  return { title: meta.title || '', meta: meta, chapters: chapters };
}

// serializeBook: Book model → raw Markdown. Round-trips parseBook (modulo whitespace normalization).
function serializeBook(book) {
  const out = [];
  const meta = Object.assign({}, book.meta);
  meta[FRONTMATTER_KEY] = 'true';
  if (book.title) meta.title = book.title;
  out.push('---');
  Object.keys(meta).forEach((k) => out.push(k + ': ' + meta[k]));
  out.push('---', '');
  (book.chapters || []).forEach((c) => {
    out.push('# ' + (c.title || ''), '');
    (c.pages || []).forEach((p) => {
      out.push('## ' + (p.title || ''));
      if (p.kind) out.push('kind: ' + p.kind);
      if (p.focus) out.push('focus: ' + p.focus);
      (p.images || []).forEach((img) => out.push(serializeImage(img)));
      if (p.caption) out.push(p.caption);
      out.push('');
    });
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/,'') + '\n';
}

// isBookFile: cheap detector for "is this Markdown a pagetile book?" (frontmatter flag), so a host can
// claim/route a file the way tugtile claims kanban files by their frontmatter key.
function isBookFile(text) {
  const { meta } = splitFrontmatter(String(text || ''));
  return meta[FRONTMATTER_KEY] === 'true' || meta[FRONTMATTER_KEY] === true;
}

// ── Photobook composition (the reader resolves each page with these) ─────────────────────
function isPhotobook(book) {
  return !!(book && book.meta && book.meta.source === PHOTOBOOK_SOURCE);
}

// defaultKind: the spec's taste-as-default, from the photo's own pixel size. Landscape → full;
// portrait → mat. A SQUARE photo is neither, and goes on a mat: full-bleed would crop half of it
// on a phone held upright, and a mat loses nothing. '' when the size is not known yet.
function defaultKind(width, height) {
  const w = Number(width), h = Number(height);
  if (!(w > 0) || !(h > 0)) return '';
  return w > h ? 'full' : 'mat';
}

// resolveLayout: a page + its lead photo's size → what the reader draws. A declared kind or focus
// always wins; only what the author left out is decided here. Same answer on a phone and a desktop
// — the viewport changes the crop that `focus` anchors, not the kind.
function resolveLayout(page, size) {
  const s = size || {};
  return { kind: (page && page.kind) || defaultKind(s.width, s.height), focus: (page && page.focus) || DEFAULT_FOCUS };
}

// ── Reading-order helpers (the reader/preview surface uses these) ─────────────────────────
// flattenPages: Book → [{ chapter, page, index }] in reading order, so a sequential reader can
// page next/prev across chapter boundaries without re-walking the tree.
function flattenPages(book) {
  const flat = [];
  (book.chapters || []).forEach((c) => (c.pages || []).forEach((p) => flat.push({ chapter: c, page: p, index: flat.length })));
  return flat;
}

// pageById: deep-link resolver for the reader (#c1-p2 → its flat index), -1 if missing.
function pageById(book, id) {
  return flattenPages(book).findIndex((e) => e.page.id === id);
}

// allImageSrcs: every image src in reading order — for the build/deploy step (CF Pages) to know which
// assets to copy, and for a thumbnail/cover pass.
function allImageSrcs(book) {
  const srcs = [];
  (book.chapters || []).forEach((c) => (c.pages || []).forEach((p) => (p.images || []).forEach((img) => srcs.push(img.src))));
  return srcs;
}

export {
  parseBook, serializeBook, isBookFile,
  flattenPages, pageById, allImageSrcs,
  parseImageLine, serializeImage, slugify,
  isPhotobook, defaultKind, resolveLayout, parseFocus, parseLayoutLine,
  FRONTMATTER_KEY, PHOTOBOOK_SOURCE, LAYOUT_KINDS, DEFAULT_FOCUS,
};
