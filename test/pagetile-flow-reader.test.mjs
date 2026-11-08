#!/usr/bin/env node
// pagetile flow READER (reef#2279, slice 2) — the reader's DOM integration, in plain Node.
//
// The engine (flow-core) is pinned by pagetile-flow.test.mjs. What this pins is the reader on top:
//   1. A chapter with a flow page OPENS as a flow reader: the server projection carries the text,
//      the engine arrives through createFlowLoader, the stage shows the engine's own lines for one
//      computed page, and the progress reads page N/M of the COMPUTED pages.
//   2. A font-size change keeps the reader on the text it was reading (and 18 → 22 → 18 lands back on
//      the same page); a reopened reader resumes there from the stored position.
//   3. A FIXED chapter is not touched: the flow view declines it without loading the engine and
//      without writing to the DOM, reader.js keeps its fixed path for it, and a fixed book's reader
//      projection is unchanged (its literal golden is in packages/sitetile/pagetile-photobook.test.mjs).
//
// The DOM is a stand-in (below) with just what flow-view.js touches; the browser half — canvas
// measureText and the drawn page — is listed as unverified in the lane report until a real-render run.
//
// Run: node test/pagetile-flow-reader.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBook } from '../packages/pagetile/book-core.js';
import { paginateBook, defaultMeasure } from '../packages/pagetile/flow-core.js';
import { createFlowLoader } from '../packages/pagetile/flow-loader.js';
import { loadReaderBook } from '../packages/sitetile/astro/src/lib/pagetile.mjs';
import { mountFlowReader } from '../packages/sitetile/astro/src/packages/pagetile-reader/flow-view.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const eq = (a, b, msg) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (ok) pass++; else { fail++; console.error('FAIL:', msg, '\n  got:', JSON.stringify(a), '\n  exp:', JSON.stringify(b)); } };
const ok = (c, msg) => { if (process.env.VERBOSE) console.log((c ? 'ok   ' : 'FAIL ') + msg); if (c) pass++; else { fail++; console.error('FAIL:', msg); } };

// ── a stand-in DOM: elements, compound selectors (tag, .class, [attr="v"]), click listeners ──────
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
class El {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.parentNode = null;
    this.dataset = {}; this.attrs = {}; this.className = ''; this._text = ''; this.listeners = [];
    const props = {};
    this.style = { setProperty: (k, v) => { props[k] = v; }, getPropertyValue: (k) => props[k] || '' };
  }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._text = String(v); }
  setAttribute(k, v) { if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = String(v); else this.attrs[k] = String(v); }
  getAttribute(k) { return k.startsWith('data-') ? this.dataset[camel(k.slice(5))] ?? null : this.attrs[k] ?? null; }
  append(...cs) { for (const c of cs) { if (c.parentNode) c.remove(); c.parentNode = this; this.children.push(c); } }
  prepend(c) { if (c.parentNode) c.remove(); c.parentNode = this; this.children.unshift(c); }
  remove() { if (this.parentNode) { const p = this.parentNode; p.children = p.children.filter((x) => x !== this); this.parentNode = null; } }
  matches(sel) {
    const m = /^([a-z0-9]*)((?:\.[\w-]+)*)((?:\[[\w-]+="[^"]*"\])*)$/i.exec(sel.trim());
    if (!m) throw new Error('stand-in DOM: unsupported selector ' + sel);
    if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
    const cls = this.className.split(/\s+/);
    if (m[2] && !m[2].split('.').filter(Boolean).every((c) => cls.includes(c))) return false;
    for (const [, k, v] of m[3].matchAll(/\[([\w-]+)="([^"]*)"\]/g)) if (this.getAttribute(k) !== v) return false;
    return true;
  }
  querySelectorAll(sel) { const out = []; const walk = (e) => { for (const c of e.children) { if (c.matches(sel)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  addEventListener(type, fn) { this.listeners.push({ type, fn }); }
  click() { const e = { type: 'click', stopImmediatePropagation() {} }; this.listeners.filter((l) => l.type === 'click').forEach((l) => l.fn(e)); }
}
function makeDoc() {
  const doc = { listeners: [], createElement: (t) => new El(t, doc), addEventListener(type, fn) { doc.listeners.push({ type, fn }); } };
  return doc;
}
const h = (doc, tag, cls, data, kids) => { const e = doc.createElement(tag); e.className = cls || ''; Object.assign(e.dataset, data || {}); (kids || []).forEach((k) => e.append(k)); return e; };
// What /preview/[chapter].astro renders for one chapter, from the same reader projection.
function chapterDom(doc, chapter, bookKey) {
  const figs = chapter.pages.map((p) => {
    const fig = h(doc, 'figure', 'ptr-page', { page: p.id, idx: String(p.pageInChapter - 1) });
    if (p.kind) fig.dataset.kind = p.kind;
    if (p.imageSrc) { const im = doc.createElement('img'); im.src = p.imageSrc; im.alt = ''; fig.append(im); }
    if (p.kind === 'flow') { const s = h(doc, 'div', 'ptr-flow-src'); s.textContent = p.caption; fig.append(s); }
    return fig;
  });
  const btn = (act) => h(doc, 'button', 'ptr-btn', { act });
  const progress = h(doc, 'span', 'ptr-progress'); progress.textContent = '1 / ' + chapter.pages.length;
  return h(doc, 'div', 'ptr', { book: bookKey, chapter: chapter.id, direction: 'ltr', mode: 'paged', prevChapter: '' }, [
    h(doc, 'header', 'ptr-bar ptr-bar-top', {}, [h(doc, 'div', 'ptr-tools', {}, [btn('spread'), btn('turn'), btn('mode'), btn('immersive')])]),
    h(doc, 'div', 'ptr-stage', {}, [h(doc, 'div', 'ptr-track', {}, figs), h(doc, 'button', 'ptr-tap ptr-tap-back'), h(doc, 'button', 'ptr-tap ptr-tap-fwd')]),
    h(doc, 'footer', 'ptr-bar ptr-bar-bottom', {}, [btn('prev'), progress, btn('next')]),
  ]);
}
const memStore = () => { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), m }; };
const countingLoader = () => { const c = { n: 0 }; c.loader = createFlowLoader({ engine: () => { c.n++; return import('../packages/pagetile/flow-core.js'); } }); return c; };
const VIEWPORT = { width: 320, height: 420 };
const LH = 1.5;   // flow-core DEFAULTS.lineHeight

// ── the specimen: a cover image, then one long flow post ──────────────────────────────────────
const PARA_EN = 'The ferry left before dawn, and the harbour lights went out one by one behind it while the gulls argued over the wake. ';
const PARA_ZH = '早晨的渡輪在天亮前出發，港口的燈一盞一盞熄滅，海鷗在船尾的浪花上爭吵不休。';
const POST = ['### A long morning', '', ...Array.from({ length: 12 }, (_, i) => (i % 3 === 2 ? PARA_ZH.repeat(4) : PARA_EN.repeat(3)) + ' (' + (i + 1) + ')').flatMap((p) => [p, ''])].join('\n').trim();
const FLOW_BOOK = ['---', 'pagetile-book: true', 'title: Morning ferry', '---', '',
  '# Chapter 1', '', '## Cover', '![[cover.png]]', '', '## The crossing', 'kind: flow', POST, ''].join('\n');
const COMIC = ['---', 'pagetile-book: true', 'title: Strip', 'direction: rtl', '---', '',
  '# Ch 1', '', '## P1', '![[pagetile/ch1/p01.jpg]]', 'kind: flow', '', '## P2', '![[pagetile/ch1/p02.jpg]]', ''].join('\n');

// ── 1. a chapter with a flow page opens as a flow reader ─────────────────────────────────────
const proj = loadReaderBook(FLOW_BOOK).chapters[0];
const flowEntry = proj.pages[1];
eq([flowEntry.kind, flowEntry.caption], ['flow', POST], 'the reader projection marks the flow page and carries its text verbatim');
eq(Object.prototype.hasOwnProperty.call(proj.pages[0], 'kind'), false, 'the fixed cover in the same book gets no kind key');

const doc = makeDoc();
const root = chapterDom(doc, proj, 'morning-ferry');
const store = memStore();
const cl = countingLoader();
const mounted = await mountFlowReader(root, { doc, win: {}, measure: defaultMeasure, viewport: VIEWPORT, store, loader: cl.loader });
ok(mounted !== null, 'mountFlowReader opens a chapter that has a flow page');
eq(cl.n, 1, 'the engine was imported through createFlowLoader, once');
eq(root.dataset.flow, 'on', 'the root is marked as a flow reader (the CSS hides the fixed track)');
const expectTotal = paginateBook(parseBook(FLOW_BOOK), Object.assign({ fontSize: 18 }, VIEWPORT)).total;
ok(expectTotal > 4, 'the post is long enough to need several computed pages (' + expectTotal + ')');
const prog = root.querySelector('.ptr-progress');
eq(prog.textContent, '1 / ' + expectTotal, 'page N/M counts the COMPUTED pages, starting on the cover');
const surface = root.querySelector('.ptr-flow-page');
ok(!!surface && surface.parentNode === root.querySelector('.ptr-stage'), 'the computed page is drawn on the stage');
eq(surface.dataset.kind, 'fixed', 'computed page 1 is the cover, a fixed page');
ok(surface.querySelector('img') && surface.querySelector('img').src === '/cover.png', 'the cover shows its own picture');
root.querySelector('[data-act="next"]').click();
eq(prog.textContent, '2 / ' + expectTotal, 'Next moves to computed page 2');
eq(surface.dataset.kind, 'flow', 'computed page 2 is the first page of the post');
const lines = surface.querySelectorAll('.ptr-flow-line');
ok(lines.length > 3, 'it is drawn as the engine\'s own lines (' + lines.length + ')');
ok(lines[0].textContent === '### A long morning', 'its first line is the post\'s heading');
const linesHeight = lines.reduce((s, l) => s + parseFloat(l.style.height) + (parseFloat(l.style.marginBottom) || 0), 0)
  - (parseFloat(lines[lines.length - 1].style.marginBottom) || 0);
ok(linesHeight <= VIEWPORT.height + 1e-6, 'the drawn lines fit the page they were counted for (' + linesHeight + ' ≤ ' + VIEWPORT.height + ')');
ok(lines.every((l) => defaultMeasure(l.textContent.trimEnd(), parseFloat(l.style.fontSize)) <= VIEWPORT.width + 1e-6), 'no drawn line is wider than the page');
eq(lines[0].style.fontSize, (18 * 1.3) + 'px', 'a heading line is set larger');
ok(root.querySelector('[data-act="font-larger"]') && root.querySelector('[data-act="font-smaller"]'), 'the toolbar gains A− / A+ for a flow chapter');

// ── 2. a font-size change keeps the reader on the text it was reading ──────────────────────
for (let i = 0; i < 4; i++) root.querySelector('[data-act="next"]').click();
const before = mounted.reader.view();
const anchor = mounted.reader.position();
ok(before.page.kind === 'flow' && before.page.part > 0, 'the reader is in the middle of the post (computed page ' + (before.index + 1) + ')');
const anchorText = parseBook(FLOW_BOOK).chapters[0].pages[1].caption.slice(anchor.offset, anchor.offset + 20);
root.querySelector('[data-act="font-larger"]').click();
const big = mounted.reader.view();
eq(big.fontSize, 20, 'A+ steps the font size to 20');
ok(big.total > before.total, 'a larger font gives more computed pages (' + before.total + ' → ' + big.total + ')');
ok(big.page.start <= anchor.offset && anchor.offset < big.page.end, 'after A+ the page on screen holds the text that was at the top before');
ok(surface.querySelectorAll('.ptr-flow-line').map((l) => l.textContent).join('\n').replace(/\s+/g, ' ').includes(anchorText.replace(/\s+/g, ' ').slice(0, 12)),
  'that text is in the drawn lines');
eq(prog.textContent, (big.index + 1) + ' / ' + big.total, 'page N/M is recounted at the new size');
root.querySelector('[data-act="font-larger"]').click();
root.querySelector('[data-act="font-smaller"]').click();
root.querySelector('[data-act="font-smaller"]').click();
eq([mounted.reader.view().fontSize, mounted.reader.view().index], [18, before.index], '18 → 20 → 22 → 20 → 18 lands back on the page it started from');
// resize reflows the same way
const narrow = mounted.reader.resize({ width: 220, height: 420 });
ok(narrow.page.start <= anchor.offset && anchor.offset < narrow.page.end, 'a narrower viewport also keeps the text on screen');
mounted.reader.resize(VIEWPORT);
// resume: a new reader on the same store opens at the same text, at the stored size
root.querySelector('[data-act="font-larger"]').click();
const atLeave = mounted.reader.view();
const doc2 = makeDoc();
const root2 = chapterDom(doc2, proj, 'morning-ferry');
const again = await mountFlowReader(root2, { doc: doc2, win: {}, measure: defaultMeasure, viewport: VIEWPORT, store, loader: createFlowLoader() });
eq([again.reader.view().fontSize, again.reader.view().index], [atLeave.fontSize, atLeave.index], 'a reopened reader resumes at the stored position and size');
// resume survives an edit above the place (the quote re-anchors it)
const edited = proj.pages.map((p) => (p.kind === 'flow' ? Object.assign({}, p, { caption: 'A new first line.\n\n' + p.caption }) : p));
const doc3 = makeDoc();
const root3 = chapterDom(doc3, Object.assign({}, proj, { pages: edited }), 'morning-ferry');
const shifted = await mountFlowReader(root3, { doc: doc3, win: {}, measure: defaultMeasure, viewport: VIEWPORT, store, loader: createFlowLoader() });
const sp = shifted.reader.position();
ok(edited[1].caption.startsWith(anchorText.slice(0, 12), sp.offset) || sp.offset === anchor.offset + 'A new first line.\n\n'.length,
  'after text was inserted above it, resume re-anchors by the quote');

// ── 3. a fixed chapter is not touched ────────────────────────────────────────────────────────
const comicProj = loadReaderBook(COMIC);
ok(comicProj.chapters[0].pages.every((p) => !Object.prototype.hasOwnProperty.call(p, 'kind')), 'a comic page gets no kind key (a late `kind: flow` is its caption)');
const fdoc = makeDoc();
const froot = chapterDom(fdoc, comicProj.chapters[0], 'strip');
const snapshot = (r) => JSON.stringify(r, (k, v) => (k === 'parentNode' || k === 'ownerDocument' || k === 'listeners' ? undefined : v));
const fbefore = snapshot(froot);
const fcl = countingLoader();
const fstore = memStore();
const fixed = await mountFlowReader(froot, { doc: fdoc, win: {}, measure: defaultMeasure, viewport: VIEWPORT, store: fstore, loader: fcl.loader });
eq(fixed, null, 'the flow view declines a fixed chapter');
eq(fcl.n, 0, 'the flow engine is not imported for it');
eq(snapshot(froot), fbefore, 'and the fixed chapter\'s DOM is exactly as the server drew it (no surface, no font buttons, no flag)');
eq(fstore.m.size, 0, 'nothing is written to storage for it');
// reader.js: the fixed path is the old initReader, untouched; the flow view is reached only by import()
const readerSrc = fs.readFileSync(path.join(HERE, '..', 'packages/sitetile/astro/src/packages/pagetile-reader/reader.js'), 'utf8');
const staticImports = [...readerSrc.matchAll(/^\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
ok(!staticImports.some((s) => /flow-(view|core|reader|loader)/.test(s)), 'reader.js imports nothing of the flow reader statically');
ok(/\.ptr-page\[data-kind="flow"\]/.test(readerSrc) && /import\(['"]\.\/flow-view\.js['"]\)/.test(readerSrc), 'reader.js hands a chapter with a flow page to flow-view.js through import()');

console.log(`pagetile-flow-reader: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
