// pagetile — the flow reader's state (reef#2279, slice 2). Platform-free: no DOM, no dependency.
//
// What a reader of a book with flow pages has to keep straight, without touching the DOM:
//   • the computed pages (flow-core paginateBook) for the CURRENT font size and viewport — page N/M
//     is a count of those, so it changes when either changes;
//   • where the reader IS, as a place in the text (flow-core positionAt), not as a page number;
//   • the lines of the page on screen, so the host draws exactly the lines the engine counted —
//     a host that let the browser re-wrap the text would overflow the page it was promised.
//
// The anchor is set by NAVIGATION only (open, goTo, step), never by a reflow: font 18 → 22 → 18
// lands on the page it started from, instead of drifting back a page on every change (each reflow
// would otherwise re-anchor at the top of the page it landed on, which is earlier in the text).
//
// The engine arrives through flow-loader.js, so a fixed book never loads it: `open()` resolves
// null for a fixed book, and the host keeps its fixed reader.
//
//   const r = createFlowReader({ book, loader, measure, viewport: { width, height }, store, key });
//   const view = await r.open();     // null → fixed book; otherwise the first view
//   r.step(1); r.setFontSize(22); r.resize({ width, height }); r.view();
//
//   View = { index, total, label: 'N / M', fontSize, canSmaller, canLarger,
//            page: Computed, lines: [{ text, size, height, gap }] | null }   lines null on a fixed page
//
// `store` is { get(key) → string|null, set(key, string) } (localStorage in the browser). What it
// keeps is { pageId, offset, quote, fontSize }: resolveOffset re-anchors the quote if the text was
// edited above it since.

import { flattenPages } from './book-core.js';

const FONT_SIZES = [14, 16, 18, 20, 22, 26, 30];
const DEFAULT_FONT_SIZE = 18;

function createFlowReader(opts) {
  const o = opts || {};
  const book = o.book || {};
  const store = o.store || null;
  const key = o.key || 'ptr-flow';
  let viewport = Object.assign({ width: 360, height: 560 }, o.viewport);
  let fontSize = FONT_SIZES.includes(Number(o.fontSize)) ? Number(o.fontSize) : DEFAULT_FONT_SIZE;
  let engine = null, paged = null, cur = 0, anchor = null;
  const layoutCache = new Map();   // pageId → layoutFlow result, for the current layout only

  const textOf = (pageId) => {
    const e = flattenPages(book).find((x) => x.page.id === pageId);
    return e ? e.page.caption || '' : '';
  };
  const layoutOpts = () => ({ width: viewport.width, height: viewport.height, fontSize, measure: o.measure });

  function reflow() {
    layoutCache.clear();
    paged = engine.paginateBook(book, layoutOpts());
    cur = anchor ? engine.locate(paged, anchor) : 0;
  }
  function save() {
    if (!store || !anchor) return;
    try { store.set(key, JSON.stringify(Object.assign({}, anchor, { fontSize }))); } catch (e) {}
  }
  function restore() {
    if (!store) return null;
    let saved = null;
    try { saved = JSON.parse(store.get(key) || 'null'); } catch (e) { return null; }
    if (!saved || typeof saved.pageId !== 'string') return null;
    if (FONT_SIZES.includes(Number(saved.fontSize))) fontSize = Number(saved.fontSize);
    const text = textOf(saved.pageId);
    return { pageId: saved.pageId, offset: engine.resolveOffset(text, saved), quote: String(saved.quote || '') };
  }

  function view() {
    if (!paged) return null;
    const page = paged.pages[cur];
    let lines = null;
    if (page && page.kind === 'flow') {
      const text = textOf(page.pageId);
      let lay = layoutCache.get(page.pageId);
      if (!lay) { lay = engine.layoutFlow(text, layoutOpts()); layoutCache.set(page.pageId, lay); }
      const lh = engine.DEFAULTS.lineHeight;
      lines = lay.lines.filter((l) => l.start >= page.start && l.start < page.end).map((l) => ({
        // the newlines a line ends with are its break, not glyphs to draw
        text: text.slice(l.start, l.end).replace(/[\r\n]+$/, ''),
        size: l.height / lh,
        height: l.height,
        gap: l.gap,
      }));
    }
    const i = FONT_SIZES.indexOf(fontSize);
    return {
      index: cur, total: paged.total, label: (cur + 1) + ' / ' + paged.total, fontSize,
      canSmaller: i > 0, canLarger: i < FONT_SIZES.length - 1, page, lines,
    };
  }

  function goTo(i) {
    if (!paged) return null;
    cur = Math.max(0, Math.min(paged.total - 1, i | 0));
    anchor = engine.positionAt(book, paged, cur);
    save();
    return view();
  }

  return {
    async open() {
      const libs = await o.loader.open(book);
      if (!libs) return null;
      engine = libs.engine;
      anchor = restore();
      reflow();
      if (!anchor) anchor = engine.positionAt(book, paged, cur);
      return view();
    },
    view,
    goTo,
    step: (d) => goTo(cur + (d < 0 ? -1 : 1)),
    // the LAST computed page (arriving from the next chapter with Prev)
    goToEnd: () => (paged ? goTo(paged.total - 1) : null),
    // the first computed page of a book page — unless the reader is already somewhere inside that
    // book page, in which case the exact text position it holds is kept (a "#pageId" link that
    // the resume link built must not throw away the place within the page)
    goToPage(pageId) {
      if (!paged) return null;
      if (paged.pages[cur] && paged.pages[cur].pageId === pageId) return view();
      const i = paged.pages.findIndex((x) => x.pageId === pageId);
      return i < 0 ? view() : goTo(i);
    },
    atStart: () => cur <= 0,
    atEnd: () => !!paged && cur >= paged.total - 1,
    position: () => anchor && Object.assign({}, anchor),
    setFontSize(size) {
      if (!paged || !FONT_SIZES.includes(Number(size))) return view();
      fontSize = Number(size);
      reflow();
      save();
      return view();
    },
    // one step along FONT_SIZES; d < 0 smaller
    nudgeFont(d) {
      const i = FONT_SIZES.indexOf(fontSize) + (d < 0 ? -1 : 1);
      return i < 0 || i >= FONT_SIZES.length ? view() : this.setFontSize(FONT_SIZES[i]);
    },
    resize(vp) {
      if (!paged || !vp || !(vp.width > 0) || !(vp.height > 0)) return view();
      if (vp.width === viewport.width && vp.height === viewport.height) return view();
      viewport = { width: vp.width, height: vp.height };
      reflow();
      return view();
    },
  };
}

export { createFlowReader, FONT_SIZES, DEFAULT_FONT_SIZE };
