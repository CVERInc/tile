// REEF with Pagetile — the reader for a chapter with FLOW pages (reef#2279, slice 2).
//
// reader.js imports this with import() only when the chapter's DOM holds a flow page
// (`.ptr-page[data-kind="flow"]`); a comic, PDF or photobook chapter never loads it and keeps
// reader.js's fixed path exactly as it was. The server rendered every flow page's text into the
// page itself (`.ptr-flow-src`, readable as is without JS); this module takes over from there:
//
//   • the chapter's pages are read back from the DOM into a book model (fixed pages by id, flow
//     pages with their text), and opened through flow-loader — the engine is import()ed here;
//   • text is measured with canvas measureText in the font the page is actually drawn in;
//   • the stage shows ONE computed page, drawn as the engine's own lines (white-space: pre, no
//     re-wrapping), so what is on screen is exactly what was counted for page N/M;
//   • A− / A+ reflow at the next font size and land on the page holding the same text; a resize
//     reflows the same way. The position is kept in localStorage as text, not a page number.
//
// `deps` is injectable ({ doc, win, measure, viewport, store, loader }) so plain Node can drive it
// with a stand-in DOM; in the browser every one of them has a default.
import { createFlowLoader } from '../../../../../pagetile/flow-loader.js';
import { createFlowReader } from '../../../../../pagetile/flow-reader.js';

const END_HASH = '__end';   // reader.js's sentinel: open this chapter on its LAST page (Prev from the next chapter)
const PAD = 24;   // the flow page's inner padding, px, each side (matches .ptr-flow-page in the route CSS)

// The chapter's pages as a book: what flow-core's paginateBook and positionAt read.
function bookFromDom(root) {
  const pages = Array.from(root.querySelectorAll('.ptr-page')).map((fig) => {
    const flow = fig.dataset.kind === 'flow';
    const src = flow ? fig.querySelector('.ptr-flow-src') : null;
    const page = { id: fig.dataset.page || '', title: '', images: [], caption: src ? src.textContent : '' };
    if (flow) page.kind = 'flow';
    return page;
  });
  return { title: '', meta: {}, chapters: [{ id: root.dataset.chapter || '', title: '', pages }] };
}

// canvas measureText in the family the flow page is drawn in. One context, re-fonted only when the
// size changes; a wide glyph run is measured as a whole, the way the browser shapes it.
function canvasMeasure(doc, family) {
  const ctx = doc.createElement('canvas').getContext('2d');
  let font = '';
  return (str, size) => {
    const f = size + 'px ' + family;
    if (f !== font) { ctx.font = f; font = f; }
    return ctx.measureText(str).width;
  };
}

function localStore(win) {
  return {
    get: (k) => { try { return win.localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { win.localStorage.setItem(k, v); } catch (e) {} },
  };
}

async function mountFlowReader(root, deps) {
  const d = deps || {};
  const doc = d.doc || root.ownerDocument;
  const win = d.win || doc.defaultView;
  const book = bookFromDom(root);
  const stage = root.querySelector('.ptr-stage');
  const figs = Array.from(root.querySelectorAll('.ptr-page'));
  // Whatever this function adds to the page is registered here. If mounting fails at ANY point the
  // list is run backwards and the error rethrown, so reader.js's fallback (initReader) starts from
  // the chapter exactly as the server drew it: no empty overlay, no hidden track, no stolen clicks.
  const undo = [];
  try { return await mount(); } catch (e) {
    for (const f of undo.reverse()) { try { f(); } catch (e2) {} }
    throw e;
  }

  async function mount() {

  // the surface the computed page is drawn on: it carries the font, so it is made before measuring
  const surface = doc.createElement('article');
  surface.className = 'ptr-flow-page';
  surface.setAttribute('aria-live', 'polite');
  const viewportNow = () => d.viewport || {
    width: Math.max(120, (stage ? stage.clientWidth : 360) - 2 * PAD),
    height: Math.max(120, (stage ? stage.clientHeight : 560) - 2 * PAD),
  };
  undo.push(() => { if (surface.remove) surface.remove(); });
  let measure = d.measure;
  if (!measure) {
    if (stage) stage.append(surface);   // in the document, so its computed font is the real one
    measure = canvasMeasure(doc, win.getComputedStyle(surface).fontFamily || 'serif');
  }

  const reader = createFlowReader({
    book, measure, viewport: viewportNow(),
    loader: d.loader || createFlowLoader(),
    store: d.store || localStore(win),
    key: 'ptr-flow:' + (root.dataset.book || 'book') + ':' + (root.dataset.chapter || ''),
  });
  let first = await reader.open();
  if (!first) { surface.remove && surface.remove(); return null; }

  root.dataset.flow = 'on';
  undo.push(() => { delete root.dataset.flow; });
  if (stage && surface.parentNode !== stage) stage.append(surface);
  // The stage was measured BEFORE data-flow="on": in a scroll-mode book that is the whole scrolling
  // track, far taller than the screen, and the first page would be laid out for that height with
  // its lower half cut off and unreachable. Now that the flow CSS has fixed the stage, measure again.
  first = reader.resize(viewportNow()) || first;

  // where to open: end sentinel > #pageId > the saved text position (already applied by open())
  const hash = String((win && win.location && win.location.hash) || '').replace(/^#/, '');
  if (hash === END_HASH) first = reader.goToEnd() || first;
  else if (hash && figs.some((f) => f.dataset.page === hash)) first = reader.goToPage(hash) || first;

  // font controls, added to the toolbar only for a flow chapter — a fixed chapter's chrome is untouched
  const tools = root.querySelector('.ptr-tools');
  const fontBtn = (act, label, title) => {
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'ptr-btn ptr-btn-font'; b.dataset.act = act;
    b.textContent = label; b.setAttribute('aria-label', title); b.title = title;
    if (tools) tools.prepend(b);
    undo.push(() => { if (b.remove) b.remove(); });
    return b;
  };
  const larger = fontBtn('font-larger', 'A+', 'Larger text');
  const smaller = fontBtn('font-smaller', 'A−', 'Smaller text');

  const progress = root.querySelector('.ptr-progress');
  const prevBtn = root.querySelector('[data-act="prev"]');
  const nextBtn = root.querySelector('[data-act="next"]');
  const prevChapterUrl = root.dataset.prevChapter || '';
  const endcap = root.querySelector('.ptr-endcap');
  const rtl = root.dataset.direction === 'rtl';
  // the book-wide "Continue reading" link (preview/index) reads this key; reader.js writes the same shape
  const store = d.store || localStore(win);
  const posKey = 'ptr-pos:' + (root.dataset.book || 'book');
  const chapterId = root.dataset.chapter || '';

  function render(v) {
    surface.textContent = '';
    surface.dataset.page = v.page.pageId;
    surface.dataset.kind = v.page.kind;
    surface.style.setProperty('--ptr-flow-size', v.fontSize + 'px');
    if (v.lines) {
      for (const l of v.lines) {
        const line = doc.createElement('div');
        line.className = 'ptr-flow-line';
        line.textContent = l.text;
        line.style.fontSize = l.size + 'px';
        line.style.height = l.height + 'px';
        if (l.gap) line.style.marginBottom = l.gap + 'px';
        surface.append(line);
      }
    } else {
      // a fixed page in a flow chapter (a cover): its own picture, as the server drew it
      const fig = figs.find((f) => f.dataset.page === v.page.pageId);
      const im = fig && fig.querySelector('img');
      if (im) { const c = doc.createElement('img'); c.src = im.currentSrc || im.src; c.alt = im.alt || ''; c.className = 'ptr-flow-fixed'; surface.append(c); }
    }
    if (v.page.pageId) store.set(posKey, JSON.stringify({ chapter: chapterId, page: v.page.pageId }));
    if (progress) progress.textContent = v.label;
    if (prevBtn) prevBtn.disabled = reader.atStart() && !prevChapterUrl;
    if (nextBtn) nextBtn.disabled = reader.atEnd() && !endcap;
    smaller.disabled = !v.canSmaller;
    larger.disabled = !v.canLarger;
  }

  function step(forward) {
    if (forward && reader.atEnd()) {
      const link = endcap && (endcap.matches && endcap.matches('a') ? endcap : endcap.querySelector('a'));
      if (link && link.href) win.location.href = link.href;
      return;
    }
    if (!forward && reader.atStart()) {
      if (prevChapterUrl) win.location.href = prevChapterUrl + '#' + END_HASH;   // → previous chapter, last page
      return;
    }
    render(reader.step(forward ? 1 : -1));
  }

  // capture phase, so the fixed reader's handlers (not attached for a flow chapter) can never also run
  const listen = (target, type, fn, capture) => {
    if (!target || !target.addEventListener) return;
    target.addEventListener(type, fn, !!capture);
    undo.push(() => { if (target.removeEventListener) target.removeEventListener(type, fn, !!capture); });
  };
  const on = (el, fn) => listen(el, 'click', (e) => { if (e.stopImmediatePropagation) e.stopImmediatePropagation(); fn(); }, true);
  on(nextBtn, () => step(true));
  on(prevBtn, () => step(false));
  on(root.querySelector('.ptr-tap-fwd'), () => step(true));
  on(root.querySelector('.ptr-tap-back'), () => step(false));
  on(smaller, () => render(reader.nudgeFont(-1)));
  on(larger, () => render(reader.nudgeFont(1)));
  // immersive mode is the same body class the fixed reader uses (its CSS hides the chrome)
  const immersiveBtn = root.querySelector('[data-act="immersive"]');
  const toggleImmersive = () => {
    if (!doc.body) return;
    const now = doc.body.classList.toggle('ptr-immersive');
    if (immersiveBtn) immersiveBtn.setAttribute('aria-pressed', now ? 'true' : 'false');
    remeasure();   // the chrome just appeared or went: the stage is a different height
  };
  on(immersiveBtn, toggleImmersive);
  on(root.querySelector('.ptr-tap-center'), toggleImmersive);
  on(root.querySelector('[data-act="close"]'), () => { if (doc.body && doc.body.classList.contains('ptr-immersive')) toggleImmersive(); });
  listen(doc, 'keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;   // Cmd/Ctrl +/− is the browser's zoom, not ours
    // ←/→ follow the reading direction, as reader.js does
    if (e.key === 'ArrowRight') { e.preventDefault(); step(!rtl); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(rtl); }
    else if (e.key === ' ') { e.preventDefault(); step(true); }
    else if (e.key === '+' || e.key === '=') render(reader.nudgeFont(1));
    else if (e.key === '-') render(reader.nudgeFont(-1));
    else if (e.key === 'f' || e.key === 'F') toggleImmersive();
    else if (e.key === 'Escape' && doc.body && doc.body.classList.contains('ptr-immersive')) toggleImmersive();
  });
  // Re-measure whenever the STAGE changes size, not only the window: immersive mode, a toolbar
  // that wraps, the mobile URL bar. reader.resize() is a no-op when the size did not change.
  let t = null;
  function remeasure() {
    if (d.viewport) return;
    clearTimeout(t);
    t = setTimeout(() => render(reader.resize(viewportNow())), 120);
  }
  undo.push(() => clearTimeout(t));
  if (!d.viewport) {
    if (stage && win && typeof win.ResizeObserver === 'function') {
      const ro = new win.ResizeObserver(remeasure);
      ro.observe(stage);
      undo.push(() => ro.disconnect());
    }
    listen(win, 'resize', remeasure);
  }

  render(first);
  return { reader, render, surface };
  }
}

export { mountFlowReader, bookFromDom, canvasMeasure };
