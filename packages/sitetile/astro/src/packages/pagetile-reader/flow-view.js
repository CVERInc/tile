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

  // the surface the computed page is drawn on: it carries the font, so it is made before measuring
  const surface = doc.createElement('article');
  surface.className = 'ptr-flow-page';
  surface.setAttribute('aria-live', 'polite');
  const viewportNow = () => d.viewport || {
    width: Math.max(120, (stage ? stage.clientWidth : 360) - 2 * PAD),
    height: Math.max(120, (stage ? stage.clientHeight : 560) - 2 * PAD),
  };
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
  const first = await reader.open();
  if (!first) { surface.remove && surface.remove(); return null; }

  root.dataset.flow = 'on';
  if (stage && surface.parentNode !== stage) stage.append(surface);

  // font controls, added to the toolbar only for a flow chapter — a fixed chapter's chrome is untouched
  const tools = root.querySelector('.ptr-tools');
  const fontBtn = (act, label, title) => {
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'ptr-btn ptr-btn-font'; b.dataset.act = act;
    b.textContent = label; b.setAttribute('aria-label', title); b.title = title;
    if (tools) tools.prepend(b);
    return b;
  };
  const larger = fontBtn('font-larger', 'A+', 'Larger text');
  const smaller = fontBtn('font-smaller', 'A−', 'Smaller text');

  const progress = root.querySelector('.ptr-progress');
  const prevBtn = root.querySelector('[data-act="prev"]');
  const nextBtn = root.querySelector('[data-act="next"]');
  const prevChapterUrl = root.dataset.prevChapter || '';
  const endcap = root.querySelector('.ptr-endcap');

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
      if (prevChapterUrl) win.location.href = prevChapterUrl;
      return;
    }
    render(reader.step(forward ? 1 : -1));
  }

  // capture phase, so the fixed reader's handlers (not attached for a flow chapter) can never also run
  const on = (el, fn) => el && el.addEventListener('click', (e) => { if (e.stopImmediatePropagation) e.stopImmediatePropagation(); fn(); }, true);
  on(nextBtn, () => step(true));
  on(prevBtn, () => step(false));
  on(root.querySelector('.ptr-tap-fwd'), () => step(true));
  on(root.querySelector('.ptr-tap-back'), () => step(false));
  on(smaller, () => render(reader.nudgeFont(-1)));
  on(larger, () => render(reader.nudgeFont(1)));
  doc.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '')) return;
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); step(true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(false); }
    else if (e.key === '+' || e.key === '=') render(reader.nudgeFont(1));
    else if (e.key === '-') render(reader.nudgeFont(-1));
  });
  if (win && win.addEventListener && !d.viewport) {
    let t = null;
    win.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => render(reader.resize(viewportNow())), 120); });
  }

  render(first);
  return { reader, render, surface };
}

export { mountFlowReader, bookFromDom, canvasMeasure };
